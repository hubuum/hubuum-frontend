import type {
	ClassSchemaResponse,
	SchemaRevisionResponse,
	SchemaStageRequest,
	SchemaWorkResponse,
} from "@/lib/api/generated/models";

export function parseSchemaDraft(
	input: string,
	enforce: boolean,
): SchemaStageRequest {
	let schema: unknown = null;
	if (input.trim()) {
		try {
			schema = JSON.parse(input);
		} catch {
			throw new Error("The proposed schema is not valid JSON.");
		}
	}
	if (
		schema !== null &&
		typeof schema !== "boolean" &&
		(typeof schema !== "object" || Array.isArray(schema))
	) {
		throw new Error(
			"Use a JSON Schema object or boolean, or leave the document empty to remove the schema.",
		);
	}
	if (schema === null && enforce) {
		throw new Error(
			"Provide a schema before enabling validation, or turn validation off to remove the schema.",
		);
	}
	return { json_schema: schema, validate_schema: enforce };
}

export function schemaDocument(value: unknown): string {
	return value == null ? "" : (JSON.stringify(value, null, 2) ?? "");
}

export function positiveSchemaId(value: string | null): number | null {
	if (!value || !/^[1-9]\d*$/.test(value)) return null;
	const id = Number(value);
	return Number.isSafeInteger(id) ? id : null;
}

export function schemaActivationBlock(
	candidate: SchemaRevisionResponse | undefined,
	active: SchemaRevisionResponse | undefined,
	summary: ClassSchemaResponse | null | undefined,
	work: SchemaWorkResponse | undefined,
): string | null {
	if (candidate?.status !== "staged")
		return "Save a staged revision before activation.";
	if (!active) return "Wait for the active revision to load.";
	if (
		summary?.active.revision === active.revision &&
		Object.values(summary.counts).every((count) => count === 0)
	)
		return null;
	if (!work)
		return "A current compatible impact analysis is required for a populated class.";
	if (
		work.kind !== "impact" ||
		work.target.class_id !== candidate.class_id ||
		work.target.revision !== candidate.revision
	)
		return "This report belongs to another revision or operation. Analyze this proposal.";
	if (work.status !== "complete")
		return `Analysis is ${work.status}. Complete a fresh analysis before activation.`;
	if (work.readiness === "incompatible")
		return "Objects fail the proposed schema. Revise the proposal or repair the objects, then analyze again.";
	if (work.readiness !== "compatible" || !work.impact)
		return "The analysis is inconclusive or outdated. Analyze again before activation.";
	if (
		work.impact.baseline.class_id !== candidate.class_id ||
		work.impact.baseline.revision !== active.revision ||
		work.current_active_schema?.revision !== active.revision ||
		work.current_active_schema?.class_id !== candidate.class_id ||
		work.current_epoch !== work.start_epoch ||
		(summary != null && summary.object_epoch !== work.start_epoch)
	)
		return "The active schema or object population changed. Analyze again before activation.";
	return null;
}
