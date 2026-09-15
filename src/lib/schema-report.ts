import type {
	SchemaActualValue,
	SchemaDiagnosticOmission,
	SchemaImpactResponse,
} from "@/lib/api/generated/models";

export const schemaOmissionLabels: Record<SchemaDiagnosticOmission, string> = {
	actual_value_redacted: "Actual value redacted",
	instance_path_redacted_or_too_long:
		"Object location redacted or too long to retain",
	schema_constraint_unavailable_or_too_large:
		"Schema constraint unavailable or too large to retain",
};

export function schemaActualDescription(actual: SchemaActualValue): string {
	if (typeof actual === "string") return actual;
	if ("string" in actual)
		return `string (${actual.string.characters} characters)`;
	if ("array" in actual) return `array (${actual.array.items} items)`;
	return `object (${actual.object.properties} properties)`;
}

export function schemaObjectUrlTemplate(
	classId: number,
	pageUrl: string,
): string {
	const page = new URL(pageUrl);
	const schemaPath = `/classes/${classId}/schema`;
	const pathname = page.pathname.replace(/\/$/, "");
	const prefix = pathname.endsWith(schemaPath)
		? pathname.slice(0, -schemaPath.length)
		: "";
	return `${page.origin}${prefix}/objects/${classId}/{object_id}`;
}

export function schemaFailureCoverage(impact: SchemaImpactResponse): {
	available: number;
	omitted: number;
} {
	let available = 0;
	let omitted = impact.ungrouped_failures;
	for (const group of impact.failures) {
		available += group.samples.length;
		// Older checkpoints may retain exact counts with only sampled IDs.
		omitted += Math.max(0, group.objects - group.samples.length);
	}
	return { available, omitted };
}
