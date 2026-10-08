import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { hubuumBffPath } from "@/lib/api/frontend";
import type {
	ObjectAggregateMeasureOperation,
	ObjectAggregateRow,
} from "@/lib/api/generated/models";
import {
	getObjectAggregatePathKey,
	sortObjectAggregateRows,
} from "@/lib/object-grouping";
import {
	appendObjectServerFilters,
	type ObjectServerFilter,
} from "@/lib/object-server-filters";

export type ObjectAggregateSort =
	| "dimensions.asc"
	| "dimensions.desc"
	| "object_count.asc"
	| "object_count.desc";

export type ObjectAggregatePage = {
	rows: ObjectAggregateRow[];
	nextCursor: string | null;
	prevCursor: string | null;
	totalCount: number | null;
	pageLimit: number | null;
};

export type ObjectAggregateMeasure = {
	field: string;
	operation: ObjectAggregateMeasureOperation;
};

export type ObjectAggregateRequest = {
	classId: number;
	groupBy: readonly string[];
	measures?: readonly ObjectAggregateMeasure[];
	sort: ObjectAggregateSort;
	limit: number;
	cursor?: string;
	filters?: readonly ObjectServerFilter[];
	includeTotal?: boolean;
};

function parsePositiveHeader(value: string | null): number | null {
	if (value === null) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCountHeader(value: string | null): number | null {
	if (value === null) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function buildObjectAggregateSearchParams(
	request: Omit<ObjectAggregateRequest, "classId">,
): URLSearchParams {
	const params = new URLSearchParams();
	if (request.groupBy.length === 0 && !request.measures?.length) {
		throw new Error("Choose at least one aggregate dimension or measure.");
	}
	for (const dimension of request.groupBy) {
		params.append("group_by", dimension);
	}
	for (const measure of request.measures ?? []) {
		params.append("aggregate", `${measure.operation}:${measure.field}`);
	}
	params.set("sort", request.sort);
	params.set("limit", String(request.limit));
	params.set("include_total", String(request.includeTotal ?? true));
	if (request.cursor) params.set("cursor", request.cursor);
	appendObjectServerFilters(params, request.filters ?? []);
	return params;
}

// ponytail: expanded depths and natural sorting load all aggregate pages.
// Very large results can be slow; callers cache them before paging locally.
export async function fetchAllObjectAggregates(
	request: Omit<ObjectAggregateRequest, "cursor" | "includeTotal">,
	signal?: AbortSignal,
	onProgress?: (count: number) => void,
): Promise<ObjectAggregateRow[]> {
	const rows = new Map<string, ObjectAggregateRow>();
	const cursors = new Set<string>();
	let cursor: string | undefined;
	do {
		signal?.throwIfAborted();
		const page = await fetchObjectAggregates(
			{ ...request, cursor, includeTotal: false },
			signal,
		);
		for (const row of page.rows) {
			rows.set(getObjectAggregatePathKey(row.dimensions), row);
		}
		onProgress?.(rows.size);
		cursor = page.nextCursor ?? undefined;
		if (cursor) {
			if (cursors.has(cursor)) {
				throw new Error(
					"The server repeated an aggregate cursor. Refresh to try again.",
				);
			}
			cursors.add(cursor);
		}
	} while (cursor);
	const result = [...rows.values()];
	return request.sort === "dimensions.asc" || request.sort === "dimensions.desc"
		? sortObjectAggregateRows(
				result,
				request.sort === "dimensions.asc" ? "asc" : "desc",
			)
		: result;
}

export async function fetchObjectAggregates(
	request: ObjectAggregateRequest,
	signal?: AbortSignal,
): Promise<ObjectAggregatePage> {
	const params = buildObjectAggregateSearchParams(request);
	const response = await fetch(
		`${hubuumBffPath(`/api/v1/classes/${request.classId}/object-aggregates`)}?${params.toString()}`,
		{ credentials: "include", ...(signal ? { signal } : {}) },
	);
	const payload: unknown = await response.json().catch(() => null);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to aggregate objects."),
		);
	}

	return {
		rows: expectArrayPayload<ObjectAggregateRow>(
			payload,
			"object aggregate rows",
		),
		nextCursor: response.headers.get("X-Next-Cursor"),
		prevCursor: response.headers.get("X-Prev-Cursor"),
		totalCount: parseCountHeader(response.headers.get("X-Total-Count")),
		pageLimit: parsePositiveHeader(response.headers.get("X-Page-Limit")),
	};
}
