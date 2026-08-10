import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";
import type {
	HubuumClassExpanded,
	HubuumObject,
} from "@/lib/api/generated/models";
import { fetchUnifiedSearchKindPage } from "@/lib/api/search";

export const RESOURCE_DIRECTORY_LIMIT = 50;

export type ResourceDirectory<T> = {
	items: T[];
	isPartial: boolean;
};

export async function fetchClassDirectory(
	query: string,
): Promise<ResourceDirectory<HubuumClassExpanded>> {
	const page = await fetchUnifiedSearchKindPage({
		kind: "class",
		q: query.trim(),
		limitPerKind: RESOURCE_DIRECTORY_LIMIT,
	});
	if (page.kind !== "class") {
		throw new Error("Unexpected class lookup response.");
	}
	return {
		items: page.results,
		isPartial: Boolean(page.next),
	};
}

export async function fetchClassObjectDirectory(
	classId: number,
	query: string,
): Promise<ResourceDirectory<HubuumObject>> {
	const trimmedQuery = query.trim();
	const params = new URLSearchParams({
		include_total: "false",
		limit: String(RESOURCE_DIRECTORY_LIMIT),
		sort: "name.asc,id.asc",
	});
	if (/^\d+$/.test(trimmedQuery)) {
		params.set("id__in", trimmedQuery);
	} else {
		params.set("name__icontains", trimmedQuery);
	}

	const response = await fetch(
		`${frontendApiPath(`/classes/${classId}/objects`)}?${params.toString()}`,
		{ credentials: "include" },
	);
	const payload: unknown = await response.json().catch(() => null);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Object lookup is unavailable."),
		);
	}
	return {
		items: expectArrayPayload<HubuumObject>(payload, "object directory"),
		isPartial: Boolean(response.headers.get("x-next-cursor")),
	};
}
