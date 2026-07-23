import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { hubuumBffPath } from "@/lib/api/frontend";
import type { ObjectAggregateRow } from "@/lib/api/generated/models";
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

type ObjectAggregateRequest = {
	classId: number;
	groupBy: readonly string[];
	sort: ObjectAggregateSort;
	limit: number;
	cursor?: string;
	filters?: readonly ObjectServerFilter[];
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
	for (const dimension of request.groupBy) {
		params.append("group_by", dimension);
	}
	params.set("sort", request.sort);
	params.set("limit", String(request.limit));
	params.set("include_total", "true");
	if (request.cursor) params.set("cursor", request.cursor);
	appendObjectServerFilters(params, request.filters ?? []);
	return params;
}

export async function fetchObjectAggregates(
	request: ObjectAggregateRequest,
): Promise<ObjectAggregatePage> {
	const params = buildObjectAggregateSearchParams(request);
	const response = await fetch(
		`${hubuumBffPath(`/api/v1/classes/${request.classId}/object-aggregates`)}?${params.toString()}`,
		{ credentials: "include" },
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
