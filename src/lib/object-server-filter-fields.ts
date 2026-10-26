import type { ComputedFieldDefinition } from "@/lib/api/generated/models";
import {
	type DiscoveredJsonField,
	discoverJsonFields,
	structuredFieldPath,
} from "@/lib/json-field-discovery";
import {
	getJsonSchemaServerFilterDataType,
	inferObjectServerFilterDataType,
	isServerFilterableDataPath,
	type ObjectComputedFilterScope,
	type ObjectComputedResultType,
	type ObjectServerFilterDataType,
	toServerFilterDataPath,
} from "@/lib/object-server-filters";

export type ServerFilterDataField = {
	id: string;
	label: string;
	path: string[];
	dataType: ObjectServerFilterDataType;
};

export type ServerFilterComputedField = {
	id: string;
	key: string;
	label: string;
	scope: ObjectComputedFilterScope;
	resultType: ObjectComputedResultType;
};

function getValueAtDataPath(data: unknown, path: readonly string[]): unknown {
	let current = data;
	for (const segment of path) {
		const arrayIndex = segment.match(/^\[(\d+)]$/);
		if (arrayIndex) {
			if (!Array.isArray(current)) return undefined;
			current = current[Number.parseInt(arrayIndex[1], 10)];
			continue;
		}
		if (
			!current ||
			typeof current !== "object" ||
			Array.isArray(current) ||
			!(segment in current)
		) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function normalizeComputedResultType(
	value: string,
): ObjectComputedResultType | null {
	if (
		value === "string" ||
		value === "number" ||
		value === "integer" ||
		value === "boolean" ||
		value === "object" ||
		value === "array"
	) {
		return value;
	}
	return null;
}

export function resolveObjectServerFilterDataFields(
	jsonSchema: unknown,
	sampleData: readonly unknown[],
): ServerFilterDataField[] {
	return discoverJsonFields(jsonSchema, [...sampleData])
		.flatMap((field) => {
			const path = toServerFilterDataPath(field.path);
			if (!path) return [];

			const schemaDataType = getJsonSchemaServerFilterDataType(
				jsonSchema,
				field.path,
			);
			const inferredDataType = inferObjectServerFilterDataType(
				sampleData.map((data) => getValueAtDataPath(data, field.path)),
			);
			const dataType =
				schemaDataType === "string" &&
				(inferredDataType === "date" || inferredDataType === "ip")
					? inferredDataType
					: (schemaDataType ?? inferredDataType);

			return [
				{
					id: JSON.stringify(path),
					label: field.label,
					path,
					dataType,
				},
			];
		})
		.sort((left, right) =>
			left.label.localeCompare(right.label, undefined, {
				numeric: true,
				sensitivity: "base",
			}),
		);
}

export function resolveObjectServerFilterComputedFields(
	sharedDefinitions: readonly ComputedFieldDefinition[],
	personalDefinitions: readonly ComputedFieldDefinition[],
): ServerFilterComputedField[] {
	function fieldsFor(
		definitions: readonly ComputedFieldDefinition[],
		scope: ObjectComputedFilterScope,
	): ServerFilterComputedField[] {
		return definitions.flatMap((definition) => {
			const resultType = normalizeComputedResultType(definition.result_type);
			return definition.enabled && resultType
				? [
						{
							id: `${scope}:${definition.key}`,
							key: definition.key,
							label: definition.label,
							scope,
							resultType,
						},
					]
				: [];
		});
	}

	return [
		...fieldsFor(sharedDefinitions, "shared"),
		...fieldsFor(personalDefinitions, "personal"),
	];
}

/** Discovery previews are display strings, not source values for type inference. */
export function discoveredServerFilterDataFields(
	jsonSchema: unknown,
	fields: readonly DiscoveredJsonField[],
): ServerFilterDataField[] {
	return fields.flatMap((field) => {
		const segments = structuredFieldPath(field);
		if (segments.some((segment) => segment.kind === "array_item")) return [];
		const path = segments.map((segment) =>
			segment.kind === "property"
				? segment.name
				: segment.kind === "array_index"
					? String(segment.index)
					: "",
		);
		if (!isServerFilterableDataPath(path)) return [];
		const types = field.types.filter(
			(type) => type !== "null" && type !== "unknown",
		);
		const observedType = types.length === 1 ? types[0] : "unknown";
		return [
			{
				id: JSON.stringify(path),
				label: field.label,
				path,
				dataType:
					getJsonSchemaServerFilterDataType(jsonSchema, field.path) ??
					observedType,
			},
		];
	});
}
