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

function compareGroupLabels(left: string, right: string): number {
	if (left === "(empty)" && right !== "(empty)") return 1;
	if (right === "(empty)" && left !== "(empty)") return -1;
	return left.localeCompare(right, undefined, {
		numeric: true,
		sensitivity: "base",
	});
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
