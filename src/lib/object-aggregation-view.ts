import type { ObjectAggregateMeasureOperation } from "@/lib/api/generated/models";
import type { ObjectAggregateMeasure } from "@/lib/api/object-aggregates";
import type { ObjectGroupSort } from "@/lib/object-grouping";
import { isServerFilterableDataPath } from "@/lib/object-server-filters";

export const OBJECT_AGGREGATION_QUERY_KEYS = [
	"groupBy",
	"aggregate",
	"groupSort",
	"aggregateView",
	"aggregateCursor",
] as const;

function isGroupingFieldId(id: string): boolean {
	if (/^object:(collection|name|description|created-at|updated-at)$/.test(id))
		return true;
	if (/^computed:(shared|personal):[a-z][a-z0-9_]{0,63}$/.test(id)) return true;
	if (id.startsWith("custom:")) return id.length > 7 && id.length <= 200;
	if (!id.startsWith("data:")) return false;
	try {
		const path: unknown = JSON.parse(id.slice(5));
		return (
			Array.isArray(path) &&
			path.length > 0 &&
			path.every((segment) => typeof segment === "string" && segment.length > 0)
		);
	} catch {
		return false;
	}
}

export function parseObjectAggregationView(
	params: Pick<URLSearchParams, "get" | "getAll">,
) {
	const groupFieldIds = [
		...new Set(params.getAll("groupBy").filter(isGroupingFieldId)),
	].slice(0, 3);
	const aggregateMeasures: (ObjectAggregateMeasure & { id: string })[] = [];
	for (const [index, entry] of params
		.getAll("aggregate")
		.slice(0, 4)
		.entries()) {
		const match = entry.match(/^(sum|average|min|max):(.+)$/);
		if (!match) continue;
		const [, operation, field] = match;
		if (
			!(
				field.startsWith("json_data.") &&
				isServerFilterableDataPath(field.slice(10).split(","))
			) &&
			!/^computed\.(shared|personal)\.[a-z][a-z0-9_]{0,63}$/.test(field)
		)
			continue;
		aggregateMeasures.push({
			id: String(index),
			field,
			operation: operation as ObjectAggregateMeasureOperation,
		});
	}
	const sort = params.get("groupSort");
	const groupSort: ObjectGroupSort =
		sort === "count-asc" || sort === "value-asc" || sort === "value-desc"
			? sort
			: "count-desc";
	return {
		groupFieldIds,
		aggregateMeasures,
		groupSort,
		aggregateLayout: params.get("aggregateView") === "table" ? "table" : "tree",
	};
}
