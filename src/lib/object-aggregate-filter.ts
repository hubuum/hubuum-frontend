import type { ObjectAggregateDimensionValue } from "@/lib/api/generated/models";
import {
	getObjectServerFilterIdentity,
	MAX_OBJECT_COMPUTED_FILTERS,
	MAX_OBJECT_SERVER_FILTERS,
	type ObjectComputedResultType,
	parseObjectServerFilterQueryParameter,
	OBJECT_SERVER_FILTERS_QUERY_KEY,
	type ObjectServerFilter,
	serializeObjectServerFilters,
} from "@/lib/object-server-filters";

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dimensionFilter({
	field,
	state,
	value,
}: ObjectAggregateDimensionValue): ObjectServerFilter {
	let operator = state === "value" ? "equals" : "is_null";
	let text = state === "value" ? String(value) : "true";
	if (field.startsWith("json_data.")) {
		if (state !== "value") {
			text = field.slice(10);
		} else {
			if (typeof value === "object") {
				throw new Error(
					"Groups containing JSON objects or arrays cannot be opened with a server filter. Group by a field inside the value instead.",
				);
			}
			operator = "regex";
			let pattern = escapeRegex(text);
			if (typeof value === "number") {
				// JSONB expands exponents and can retain trailing fractional zeroes.
				const decimal = value.toLocaleString("en-US", {
					useGrouping: false,
					maximumSignificantDigits: 21,
				});
				pattern = `${escapeRegex(decimal)}${decimal.includes(".") ? "0*" : "(\\.0+)?"}`;
				if (/[eE]/.test(text)) pattern = `(${pattern}|${escapeRegex(text)})`;
			}
			text = `${field.slice(10)}=^${pattern}$`;
		}
		field = "json_data";
	} else if (state === "value") {
		text = typeof value === "string" ? value : JSON.stringify(value);
		if (typeof value === "string" && (!text || text !== text.trim())) {
			operator = "regex";
			text = `^${escapeRegex(text)}$`;
		} else if (
			(field === "created_at" || field === "updated_at") &&
			!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)
		) {
			text += "Z";
		}
	}
	const computed = field.match(
		/^computed\.(shared|personal)\.([a-z][a-z0-9_]{0,63})$/,
	);
	const resultType: ObjectComputedResultType = Array.isArray(value)
		? "array"
		: value && typeof value === "object"
			? "object"
			: typeof value === "number"
				? "number"
				: typeof value === "boolean"
					? "boolean"
					: "string";
	const filter = parseObjectServerFilterQueryParameter(
		`${field}__${operator}`,
		text,
		computed
			? [
					{
						scope: computed[1] === "shared" ? "shared" : "personal",
						key: computed[2],
						resultType,
					},
				]
			: [],
	);
	if (!filter)
		throw new Error("This group cannot be represented by a server filter.");
	return filter;
}

export function getObjectAggregateMemberFilters(
	dimensions: readonly ObjectAggregateDimensionValue[],
	filters: readonly ObjectServerFilter[] = [],
): ObjectServerFilter[] {
	const combined = [
		...new Map(
			[...filters, ...dimensions.map(dimensionFilter)].map((filter) => [
				getObjectServerFilterIdentity(filter),
				filter,
			]),
		).values(),
	];
	if (
		combined.filter((filter) => filter.field === "computed").length >
		MAX_OBJECT_COMPUTED_FILTERS
	) {
		throw new Error(
			"This group needs more than two computed filters. Remove a computed source filter or grouping field to open its objects.",
		);
	}
	if (combined.length > MAX_OBJECT_SERVER_FILTERS) {
		throw new Error(
			`This group needs more than ${MAX_OBJECT_SERVER_FILTERS} server filters. Remove a source filter or grouping field to open its objects.`,
		);
	}
	return combined;
}

export function buildObjectAggregateObjectsHref(
	classId: number,
	filters: readonly ObjectServerFilter[],
	limit: number,
): string {
	const params = new URLSearchParams({
		classId: String(classId),
		limit: String(limit),
	});
	if (filters.length)
		params.set(
			OBJECT_SERVER_FILTERS_QUERY_KEY,
			serializeObjectServerFilters(filters),
		);
	return `/objects?${params.toString()}`;
}
