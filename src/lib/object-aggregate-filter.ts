import type { ObjectAggregateDimensionValue } from "@/lib/api/generated/models";
import { OBJECT_AGGREGATION_QUERY_KEYS } from "@/lib/object-aggregation-view";
import {
	isServerFilterableDataPath,
	OBJECT_SERVER_FILTERS_QUERY_KEY,
	type ObjectServerFilter,
	serializeObjectServerFilters,
} from "@/lib/object-server-filters";

export const OBJECT_AGGREGATE_FILTER_QUERY_KEY = "objectAggregate";

export function appendObjectAggregateFilters(
	params: URLSearchParams,
	dimensions: readonly ObjectAggregateDimensionValue[],
): void {
	for (const { field, state, value } of dimensions) {
		if (field.startsWith("json_data.")) {
			const path = field.slice(10);
			if (state !== "value") {
				params.append("json_data__is_null", path);
			} else {
				if (typeof value === "object") {
					// ponytail: whole JSON groups need structural server equality, never a client scan.
					throw new Error(
						"Groups containing JSON objects or arrays cannot be opened with a server filter. Group by a field inside the value instead.",
					);
				}
				// Text matching accepts both 9 and "9", and avoids the equals
				// operator's integer/date inference for decimals and version labels.
				const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				params.append("json_data__regex", `${path}=^${escaped}$`);
			}
		} else if (state !== "value") {
			params.append(`${field}__is_null`, "true");
		} else {
			let text = typeof value === "string" ? value : JSON.stringify(value);
			if (
				(field === "created_at" || field === "updated_at") &&
				!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)
			)
				text += "Z";
			params.append(`${field}__equals`, text);
		}
	}
}

export function parseObjectAggregateFilter(
	serialized: string,
): ObjectAggregateDimensionValue[] {
	const dimensions: unknown = JSON.parse(serialized);
	if (!Array.isArray(dimensions) || dimensions.length > 3) {
		throw new Error(
			"Invalid aggregate filter. Open the group again to recreate this link.",
		);
	}
	return dimensions.map((dimension: unknown) => {
		if (!dimension || typeof dimension !== "object")
			throw new Error("Invalid aggregate filter dimension.");
		const { field, state, value } = dimension as Record<string, unknown>;
		if (typeof field !== "string")
			throw new Error("Invalid aggregate filter field.");
		const json =
			field.startsWith("json_data.") &&
			isServerFilterableDataPath(field.slice(10).split(","));
		const computed = /^computed\.(shared|personal)\.[a-z][a-z0-9_]{0,63}$/.test(
			field,
		);
		const scalar = [
			"name",
			"description",
			"collection_id",
			"created_at",
			"updated_at",
		].includes(field);
		if (!json && !computed && !scalar)
			throw new Error("Unsupported aggregate filter field.");
		if (state === "value" && value !== undefined && value !== null)
			return { field, state, value };
		if (
			(state === "null" && (json || computed)) ||
			(state === "missing" && json) ||
			(state === "unavailable" && computed)
		)
			return { field, state };
		throw new Error("Invalid aggregate filter value.");
	});
}

export function buildObjectAggregateObjectsHref(
	classId: number,
	dimensions: readonly ObjectAggregateDimensionValue[],
	filters: readonly ObjectServerFilter[],
	limit: number,
	viewParams?: Pick<URLSearchParams, "getAll">,
): string {
	const params = new URLSearchParams({
		classId: String(classId),
		limit: String(limit),
		[OBJECT_AGGREGATE_FILTER_QUERY_KEY]: JSON.stringify(dimensions),
	});
	for (const key of OBJECT_AGGREGATION_QUERY_KEYS) {
		for (const value of viewParams?.getAll(key) ?? [])
			params.append(key, value);
	}
	if (filters.length)
		params.set(
			OBJECT_SERVER_FILTERS_QUERY_KEY,
			serializeObjectServerFilters(filters),
		);
	return `/objects?${params.toString()}`;
}
