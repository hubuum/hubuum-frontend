import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";
import type {
	HubuumObject,
	HubuumObjectComputedResponse,
} from "@/lib/api/generated/models";
import {
	appendObjectServerFilters,
	type ObjectServerFilter,
} from "@/lib/object-server-filters";
import { resolveServerPageLimit } from "@/lib/server-page-limit";

export const CLASS_OBJECT_SAMPLES_STALE_TIME = 5 * 60_000;
export const CLASS_OBJECT_SAMPLES_GC_TIME = 30 * 60_000;

export function classObjectSamplesQueryKey(classId: number | null) {
	return ["class-object-samples", classId] as const;
}

export async function fetchClassObjectSamples(
	classId: number,
	limit = 100,
): Promise<HubuumObject[]> {
	const params = new URLSearchParams({
		include_total: "false",
		limit: String(limit),
		sort: "id.asc",
	});
	const response = await fetch(
		`${frontendApiPath(`/classes/${classId}/objects`)}?${params.toString()}`,
		{ credentials: "include" },
	);
	const payload: unknown = await response.json().catch(() => null);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to inspect objects in this class."),
		);
	}
	return expectArrayPayload<HubuumObject>(payload, "class object samples");
}

export type ObjectsPageData = {
	objects: HubuumObjectComputedResponse[];
	nextCursor: string | null;
	prevCursor: string | null;
	totalCount: number | null;
};

export async function fetchObjectsByClass(
	classId: number,
	limit: number,
	cursor?: string,
	sort?: string,
	serverFilters: readonly ObjectServerFilter[] = [],
	signal?: AbortSignal,
): Promise<ObjectsPageData> {
	const params = new URLSearchParams();
	params.set("limit", String(resolveServerPageLimit(limit)));
	params.set("include", "computed");
	if (cursor) params.set("cursor", cursor);
	if (sort) params.set("sort", sort);
	appendObjectServerFilters(params, serverFilters);

	const response = await fetch(
		`${frontendApiPath(`/classes/${classId}/objects`)}?${params.toString()}`,
		{
			credentials: "include",
			signal,
		},
	);
	const payload: unknown = await response.json().catch(() => null);

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(payload, "Failed to load objects."));
	}

	const nextCursor = response.headers.get("X-Next-Cursor");
	const prevCursor = response.headers.get("X-Prev-Cursor");
	const totalCountHeader = response.headers.get("X-Total-Count");
	const totalCount = totalCountHeader
		? Number.parseInt(totalCountHeader, 10)
		: null;

	return {
		objects: expectArrayPayload<HubuumObjectComputedResponse>(
			payload,
			"class objects",
		),
		nextCursor,
		prevCursor,
		totalCount: Number.isFinite(totalCount) ? totalCount : null,
	};
}
