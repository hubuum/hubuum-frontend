import type {
	QueryUsageOperation,
	QueryUsagePatternSchema,
	QueryUsageValueType,
} from "@/lib/api/generated/models";

export const QUERY_USAGE_OPERATIONS: Record<QueryUsageOperation, string> = {
	equals: "Equals",
	gt: "Greater than",
	gte: "Greater than or equal",
	lt: "Less than",
	lte: "Less than or equal",
	between: "Between",
};

export function queryUsageOperations(
	type: QueryUsageValueType,
): QueryUsageOperation[] {
	return type === "numeric"
		? ["equals", "gt", "gte", "lt", "lte", "between"]
		: ["equals"];
}

export function queryUsagePatternError(
	pattern: QueryUsagePatternSchema,
): string | null {
	if (!pattern.path.trim()) return "Enter a JSON path.";
	if (new TextEncoder().encode(pattern.path).length > 512)
		return "JSON paths must fit within 512 bytes.";
	const segments = pattern.path.split(",");
	if (segments.length > 32 || segments.some((part) => !part.trim()))
		return "Use 1–32 nonempty path segments separated by commas.";
	const allowed = queryUsageOperations(pattern.value_type);
	if (
		!pattern.operations.length ||
		pattern.operations.some((operation) => !allowed.includes(operation))
	)
		return "Choose at least one operation supported by this value type.";
	return null;
}

export function queryUsagePatternLabel(
	pattern: QueryUsagePatternSchema,
): string {
	return `${pattern.path} · ${pattern.value_type} · ${pattern.operations.map((operation) => QUERY_USAGE_OPERATIONS[operation]).join(", ")}`;
}

export function hasQueryUsageDeclaration(
	declarations: { pattern: QueryUsagePatternSchema }[],
	pattern: QueryUsagePatternSchema,
): boolean {
	return declarations.some(
		({ pattern: existing }) =>
			existing.path === pattern.path &&
			existing.value_type === pattern.value_type,
	);
}
