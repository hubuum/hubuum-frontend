import type {
	ObjectAggregateMeasureOperation,
	ObjectAggregateMeasureValue,
	ObjectAggregateRow,
} from "@/lib/api/generated/models";

export type ObjectGroupSort =
	| "count-desc"
	| "count-asc"
	| "value-asc"
	| "value-desc";

export type ObjectGroup<Row> = {
	id: string;
	value: unknown;
	label: string;
	count: number;
	rows: Row[];
};

export type ObjectAggregateDimension = {
	field?: string;
	state: "value" | "null" | "missing" | "unavailable";
	value?: unknown;
};

function stableJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableJsonValue);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, nestedValue]) => [key, stableJsonValue(nestedValue)]),
		);
	}
	return value;
}

export function getObjectAggregatePathKey(
	dimensions: readonly ObjectAggregateDimension[],
): string {
	return JSON.stringify(stableJsonValue(dimensions));
}

export function indexObjectAggregateChildren(
	rows: readonly ObjectAggregateRow[],
): Map<string, ObjectAggregateRow[]> {
	const children = new Map<string, ObjectAggregateRow[]>();
	for (const row of rows) {
		const key = getObjectAggregatePathKey(row.dimensions.slice(0, -1));
		const siblings = children.get(key);
		if (siblings) siblings.push(row);
		else children.set(key, [row]);
	}
	return children;
}

export function sortObjectAggregateRows(
	rows: readonly ObjectAggregateRow[],
	direction: "asc" | "desc",
): ObjectAggregateRow[] {
	const stateOrder = { value: 0, null: 1, missing: 2, unavailable: 3 };
	return [...rows].sort((left, right) => {
		for (let index = 0; index < left.dimensions.length; index += 1) {
			const a = left.dimensions[index];
			const b = right.dimensions[index];
			if (!b) return 1;
			const stateComparison = stateOrder[a.state] - stateOrder[b.state];
			if (stateComparison) return stateComparison;
			if (a.state !== "value") continue;
			const comparison =
				typeof a.value === "number" && typeof b.value === "number"
					? a.value - b.value
					: compareGroupLabels(
							formatObjectGroupValue(a.value),
							formatObjectGroupValue(b.value),
						);
			if (comparison) return direction === "asc" ? comparison : -comparison;
		}
		return left.dimensions.length - right.dimensions.length;
	});
}

function serializeGroupValue(value: unknown): string {
	if (value === undefined || value === null || value === "") {
		return "empty";
	}
	if (typeof value === "number") {
		return `number:${Number.isNaN(value) ? "NaN" : value}`;
	}
	if (typeof value === "string") return `string:${value}`;
	if (typeof value === "boolean") return `boolean:${value}`;
	if (typeof value === "bigint") return `bigint:${value}`;
	try {
		return `json:${JSON.stringify(stableJsonValue(value))}`;
	} catch {
		return `${typeof value}:${String(value)}`;
	}
}

export function formatObjectGroupValue(value: unknown): string {
	if (value === undefined || value === null || value === "") {
		return "(empty)";
	}
	if (typeof value === "string") return value;
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}
	try {
		return JSON.stringify(stableJsonValue(value));
	} catch {
		return String(value);
	}
}

export function formatObjectAggregateDimension(
	dimension: ObjectAggregateDimension,
	collectionNames?: ReadonlyMap<number, string>,
): string {
	if (dimension.state === "null") return "(null)";
	if (dimension.state === "missing") return "(missing)";
	if (dimension.state === "unavailable") return "(unavailable)";
	if (
		dimension.field === "collection_id" &&
		typeof dimension.value === "number"
	) {
		const name = collectionNames?.get(dimension.value);
		return name ? `${name} (#${dimension.value})` : `#${dimension.value}`;
	}
	return formatObjectGroupValue(dimension.value);
}

export function formatObjectAggregateMeasure(
	measure: Pick<ObjectAggregateMeasureValue, "state" | "value">,
): string {
	return measure.state === "empty"
		? "—"
		: formatObjectGroupValue(measure.value);
}

export function formatObjectAggregateMeasureLabel(
	operation: ObjectAggregateMeasureOperation,
	fieldLabel: string,
): string {
	const operationLabel =
		operation === "average"
			? "Average"
			: operation === "min"
				? "Minimum"
				: operation === "max"
					? "Maximum"
					: "Sum";
	return `${operationLabel} · ${fieldLabel}`;
}

const groupCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function compareGroupLabels(left: string, right: string): number {
	if (left === "(empty)" && right !== "(empty)") return 1;
	if (right === "(empty)" && left !== "(empty)") return -1;
	return groupCollator.compare(left, right);
}

export function groupObjectRows<Row>(
	rows: readonly Row[],
	getValue: (row: Row) => unknown,
	sort: ObjectGroupSort,
): ObjectGroup<Row>[] {
	const groups = new Map<string, ObjectGroup<Row>>();
	for (const row of rows) {
		const value = getValue(row);
		const id = serializeGroupValue(value);
		const current = groups.get(id);
		if (current) {
			current.rows.push(row);
			current.count += 1;
			continue;
		}
		groups.set(id, {
			id,
			value,
			label: formatObjectGroupValue(value),
			count: 1,
			rows: [row],
		});
	}

	return [...groups.values()].sort((left, right) => {
		const labelComparison = compareGroupLabels(left.label, right.label);
		if (sort === "value-asc") return labelComparison;
		if (sort === "value-desc") {
			if (left.label === "(empty)" || right.label === "(empty)") {
				return labelComparison;
			}
			return -labelComparison;
		}

		const countComparison = left.count - right.count;
		if (countComparison !== 0) {
			return sort === "count-asc" ? countComparison : -countComparison;
		}
		return labelComparison;
	});
}
