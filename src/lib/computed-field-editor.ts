import type { ComputedOperationType } from "@/lib/api/computed-fields";
import type { ComputedResultType } from "@/lib/api/generated/models";
import {
	type DiscoveredJsonField,
	JSON_ARRAY_ITEM_SEGMENT,
	type JsonFieldType,
} from "@/lib/json-field-discovery";

const ARRAY_INDEX = /^\[(\d+)\]$/;
const FIELD_LABEL_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

export type ComputedOperationOption = {
	description: string;
	label: string;
	value: ComputedOperationType;
};

export const COMPUTED_OPERATIONS: ComputedOperationOption[] = [
	{
		value: "first_non_null",
		label: "First non-null",
		description: "Use the first input with a value. Input order matters.",
	},
	{
		value: "sum",
		label: "Sum",
		description: "Add the numeric input values together.",
	},
	{
		value: "average",
		label: "Average",
		description: "Calculate the average of the numeric input values.",
	},
	{
		value: "min",
		label: "Minimum",
		description: "Return the smallest numeric input value.",
	},
	{
		value: "max",
		label: "Maximum",
		description: "Return the largest numeric input value.",
	},
	{
		value: "all_present",
		label: "All present",
		description: "Return true when every input has a value.",
	},
	{
		value: "any_present",
		label: "Any present",
		description: "Return true when at least one input has a value.",
	},
	{
		value: "count_present",
		label: "Count present",
		description: "Count how many inputs have values.",
	},
	{
		value: "all_present_and_equal",
		label: "All present and equal",
		description: "Return true when at least two inputs exist and are equal.",
	},
];

export function arrayItemCount(path: readonly string[]): number {
	return path.filter((segment) => segment === JSON_ARRAY_ITEM_SEGMENT).length;
}

export function sortDiscoveredJsonFields(
	fields: readonly DiscoveredJsonField[],
): DiscoveredJsonField[] {
	return [...fields].sort((left, right) => {
		const labelOrder = FIELD_LABEL_COLLATOR.compare(left.label, right.label);
		if (labelOrder !== 0) return labelOrder;
		return left.path.join(".").localeCompare(right.path.join("."));
	});
}

function escapeJsonPointerSegment(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function jsonPointerFromFieldPath(
	path: readonly string[],
	arrayIndexes: readonly string[] = [],
): string | null {
	let arrayIndex = 0;
	const pointerSegments: string[] = [];
	for (const segment of path) {
		if (segment === JSON_ARRAY_ITEM_SEGMENT) {
			const value = arrayIndexes[arrayIndex++]?.trim() ?? "";
			if (!/^(0|[1-9]\d*)$/.test(value)) return null;
			pointerSegments.push(value);
			continue;
		}
		const fixedIndex = ARRAY_INDEX.exec(segment);
		pointerSegments.push(fixedIndex ? fixedIndex[1] : segment);
	}
	return `/${pointerSegments.map(escapeJsonPointerSegment).join("/")}`;
}

export function pathsToText(paths: readonly string[]): string {
	return paths.map((path) => (path === "" ? "<root>" : path)).join("\n");
}

function pointerPatternForField(field: DiscoveredJsonField): RegExp {
	const segments = field.path.map((segment) => {
		if (segment === JSON_ARRAY_ITEM_SEGMENT) return "(?:0|[1-9]\\d*)";
		const fixedIndex = ARRAY_INDEX.exec(segment);
		const pointerSegment = fixedIndex ? fixedIndex[1] : segment;
		return escapeJsonPointerSegment(pointerSegment).replace(
			/[.*+?^${}()|[\]\\]/g,
			"\\$&",
		);
	});
	return new RegExp(`^/${segments.join("/")}$`);
}

export function fieldForJsonPointer(
	fields: readonly DiscoveredJsonField[],
	pointer: string,
): DiscoveredJsonField | null {
	return (
		fields.find((field) => pointerPatternForField(field).test(pointer)) ?? null
	);
}

function meaningfulTypes(types: readonly JsonFieldType[]): JsonFieldType[] {
	return types.filter((type) => type !== "null" && type !== "unknown");
}

function isNumericField(field: DiscoveredJsonField): boolean {
	const types = meaningfulTypes(field.types);
	return types.length === 0 || types.every((type) => type === "number");
}

export function operationCompatibility(
	operation: ComputedOperationType,
	paths: readonly string[],
	selectedFields: readonly (DiscoveredJsonField | null)[],
): { compatible: boolean; reason: string | null } {
	const minimum = operation === "all_present_and_equal" ? 2 : 1;
	if (paths.length < minimum) {
		return {
			compatible: false,
			reason: `Select at least ${minimum} input${minimum === 1 ? "" : "s"}.`,
		};
	}
	if (paths.length > 16) {
		return { compatible: false, reason: "Select no more than 16 inputs." };
	}
	if (
		["sum", "average", "min", "max"].includes(operation) &&
		selectedFields.some((field) => field && !isNumericField(field))
	) {
		return {
			compatible: false,
			reason: "This operation accepts numeric fields only.",
		};
	}
	return { compatible: true, reason: null };
}

export function resultTypesForOperation(
	operation: ComputedOperationType,
): ComputedResultType[] {
	if (["sum", "average", "min", "max"].includes(operation)) {
		return ["number", "integer"];
	}
	if (operation === "count_present") return ["integer"];
	if (
		["all_present", "any_present", "all_present_and_equal"].includes(operation)
	) {
		return ["boolean"];
	}
	return ["string", "number", "integer", "boolean", "object", "array"];
}

export function recommendedResultType(
	operation: ComputedOperationType,
	selectedFields: readonly (DiscoveredJsonField | null)[],
	fallback: ComputedResultType,
): ComputedResultType {
	const allowed = resultTypesForOperation(operation);
	if (allowed.length === 1) return allowed[0];
	if (operation !== "first_non_null") {
		return allowed.includes(fallback) ? fallback : allowed[0];
	}
	const knownTypes = selectedFields
		.flatMap((field) => (field ? meaningfulTypes(field.types) : []))
		.filter((type, index, values) => values.indexOf(type) === index);
	if (knownTypes.length === 1) {
		const inferred = knownTypes[0] as ComputedResultType;
		if (allowed.includes(inferred)) return inferred;
	}
	return allowed.includes(fallback) ? fallback : "string";
}

export function slugifyComputedFieldKey(label: string): string {
	const normalized = label
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	const withPrefix = /^[a-z]/.test(normalized)
		? normalized
		: normalized
			? `field_${normalized}`
			: "field";
	return withPrefix.slice(0, 64).replace(/_+$/g, "");
}

function unescapeJsonPointerSegment(segment: string): string {
	return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function readJsonPointer(document: unknown, pointer: string): unknown {
	if (pointer === "") return document;
	if (!pointer.startsWith("/")) return undefined;
	let current = document;
	for (const rawSegment of pointer.slice(1).split("/")) {
		const segment = unescapeJsonPointerSegment(rawSegment);
		if (Array.isArray(current)) {
			if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
			current = current[Number.parseInt(segment, 10)];
			continue;
		}
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}
