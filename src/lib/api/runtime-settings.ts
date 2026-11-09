import { z } from "zod";

import { getApiErrorMessage } from "@/lib/api/errors";
import { hubuumBffPath } from "@/lib/api/frontend";
import type {
	RuntimeSettingsDescriptor as ServerRuntimeSettingsDescriptor,
	RuntimeSettingsPatch,
} from "@/lib/api/generated/models";

// Discovery accepts groups and effects introduced after the pinned server.
export type RuntimeSettingsDescriptor = Omit<
	ServerRuntimeSettingsDescriptor,
	"key" | "takes_effect"
> & { key: string; takes_effect: string };

const descriptorSchema: z.ZodType<RuntimeSettingsDescriptor> = z.object({
	key: z.string().regex(/^[a-zA-Z0-9_]+$/),
	title: z.string(),
	description: z.string(),
	schema: z.record(z.string(), z.unknown()),
	patch_supported: z.boolean(),
	requires_local_admin: z.boolean(),
	takes_effect: z.string(),
	read_only_reason: z.string().nullish(),
});
const catalogueSchema = z.object({
	schema_version: z.number().int(),
	groups: z.array(descriptorSchema),
});
const stateSchema = z.object({
	group: z.string(),
	source: z.string(),
	revision: z
		.number()
		.int()
		.positive()
		.safe()
		.nullish()
		.transform((value) => value ?? null),
	mutable: z.boolean(),
	restart_required: z.boolean(),
	takes_effect: z.string(),
	replica: z.object({ status: z.string() }).passthrough(),
	effective: z.record(z.string(), z.unknown()),
	runtime: z
		.record(z.string(), z.unknown())
		.nullish()
		.transform((value) => value ?? null),
	deployment: z
		.record(z.string(), z.unknown())
		.nullish()
		.transform((value) => value ?? null),
	constrained_by_ceiling: z.boolean(),
});

export type RuntimeSettingsState = z.infer<typeof stateSchema>;
export type RuntimeField = {
	name: string;
	title: string;
	description?: string;
	unit?: string;
	kind: "boolean" | "integer" | "number" | "string" | "enum" | "readonly";
	minimum?: number;
	maximum?: number;
	choices?: string[];
	choiceDescriptions?: Record<string, string>;
};

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function runtimeFields(
	descriptor: RuntimeSettingsDescriptor,
): RuntimeField[] {
	return Object.entries(object(descriptor.schema.properties)).map(
		([name, raw]) => {
			const field = object(raw);
			const choices =
				Array.isArray(field.enum) &&
				field.enum.length > 0 &&
				field.enum.every((v) => typeof v === "string")
					? (field.enum as string[])
					: undefined;
			// Unknown validation/composition rules require a dedicated editor. New
			// descriptive annotations do not prevent existing scalar controls working.
			const unsupported =
				descriptor.schema.readOnly === true ||
				["$ref", "oneOf", "anyOf", "allOf"].some(
					(key) => key in descriptor.schema,
				) ||
				field.readOnly === true ||
				field.writeOnly === true ||
				("enum" in field && choices === undefined) ||
				"$ref" in field ||
				"oneOf" in field ||
				"anyOf" in field ||
				"allOf" in field;
			const kind = unsupported
				? "readonly"
				: choices
					? "enum"
					: ["boolean", "integer", "number", "string"].includes(
								String(field.type),
							)
						? (field.type as RuntimeField["kind"])
						: "readonly";
			return {
				name,
				title:
					typeof field.title === "string"
						? field.title
						: name.replaceAll("_", " "),
				description:
					typeof field.description === "string" ? field.description : undefined,
				unit: typeof field["x-unit"] === "string" ? field["x-unit"] : undefined,
				kind,
				minimum: typeof field.minimum === "number" ? field.minimum : undefined,
				maximum: typeof field.maximum === "number" ? field.maximum : undefined,
				choices,
				choiceDescriptions: Object.fromEntries(
					(choices ?? []).flatMap((choice) => {
						const help = object(field["x-enum-descriptions"])[choice];
						return typeof help === "string" && help.trim()
							? [[choice, help]]
							: [];
					}),
				),
			};
		},
	);
}

export function runtimeChanges(
	descriptor: RuntimeSettingsDescriptor,
	drafts: Record<string, string | boolean>,
	initial: Record<string, unknown>,
): Record<string, unknown> {
	const changes: Record<string, unknown> = Object.create(null);
	for (const field of runtimeFields(descriptor)) {
		if (!Object.hasOwn(drafts, field.name) || field.kind === "readonly")
			continue;
		const input = drafts[field.name];
		let value: string | number | boolean = input;
		if (field.kind === "integer" || field.kind === "number") {
			if (typeof input !== "string" || input.trim() === "")
				throw new Error(`${field.title} requires a number.`);
			value = Number(input);
			if (
				!Number.isFinite(value) ||
				(field.kind === "integer" && !Number.isSafeInteger(value))
			)
				throw new Error(`${field.title} requires a valid ${field.kind}.`);
			if (field.minimum !== undefined && value < field.minimum)
				throw new Error(`${field.title} must be at least ${field.minimum}.`);
			if (field.maximum !== undefined && value > field.maximum)
				throw new Error(`${field.title} must be at most ${field.maximum}.`);
		}
		if (field.kind === "boolean" && typeof value !== "boolean")
			throw new Error(`${field.title} requires a boolean.`);
		if (field.kind === "enum" && !field.choices?.includes(String(value)))
			throw new Error(`${field.title} requires one of the advertised values.`);
		if (value !== initial[field.name]) changes[field.name] = value;
	}
	return changes;
}

const root = "/api/v1/admin/runtime-settings";
async function read(response: Response): Promise<unknown> {
	const body: unknown = await response.json();
	if (!response.ok) {
		if (response.status === 412)
			throw new Error(
				"Settings changed since you loaded them. Reload settings and review your changes before saving again.",
			);
		throw new Error(
			getApiErrorMessage(body, "Unable to access runtime settings."),
		);
	}
	return body;
}
export async function fetchRuntimeSettingsCatalogue() {
	const response = await fetch(hubuumBffPath(`${root}/schema`), {
		credentials: "include",
		cache: "no-store",
	});
	if (response.status === 404) return null;
	return catalogueSchema.parse(await read(response));
}
export async function fetchRuntimeSettingsGroup(group: string) {
	const response = await fetch(
		hubuumBffPath(`${root}/${encodeURIComponent(group)}`),
		{ credentials: "include", cache: "no-store" },
	);
	return stateSchema.parse(await read(response));
}
export async function saveRuntimeSettings(
	group: string,
	revision: number,
	changes: Record<string, unknown>,
) {
	const patch: RuntimeSettingsPatch = { expected_revision: revision, changes };
	const response = await fetch(
		hubuumBffPath(`${root}/${encodeURIComponent(group)}`),
		{
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		},
	);
	return z
		.object({
			committed_revision: z.number().int().positive().safe(),
			applied_by_responding_replica: z.boolean(),
		})
		.parse(await read(response));
}
