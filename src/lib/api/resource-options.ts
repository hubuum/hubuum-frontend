import { type CursorPage, collectAllCursorPages } from "@/lib/api/cursor-pages";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { hubuumBffPath } from "@/lib/api/frontend";
import type {
	Collection,
	HubuumClassExpanded,
} from "@/lib/api/generated/models";
import { fetchUnifiedSearch } from "@/lib/api/search";

export type ResourceOption = Collection | HubuumClassExpanded;
export type ResourceOptionKind = "class" | "collection";

export function fetchResourceOptions(
	kind: "collection",
	query: string,
	cursor?: string,
	signal?: AbortSignal,
): Promise<CursorPage<Collection>>;
export function fetchResourceOptions(
	kind: "class",
	query: string,
	cursor?: string,
	signal?: AbortSignal,
): Promise<CursorPage<HubuumClassExpanded>>;
export function fetchResourceOptions(
	kind: ResourceOptionKind,
	query: string,
	cursor?: string,
	signal?: AbortSignal,
): Promise<CursorPage<ResourceOption>>;
export async function fetchResourceOptions(
	kind: ResourceOptionKind,
	query: string,
	cursor?: string,
	signal?: AbortSignal,
) {
	if (query.trim()) {
		const page = await fetchUnifiedSearch(
			{
				q: query.trim(),
				kinds: [kind],
				limitPerKind: 50,
				...(kind === "class"
					? { cursorClasses: cursor }
					: { cursorCollections: cursor }),
			},
			{ signal },
		);
		return kind === "class"
			? {
					items: page.results.classes as ResourceOption[],
					nextCursor: page.next.classes,
				}
			: {
					items: page.results.collections as ResourceOption[],
					nextCursor: page.next.collections,
				};
	}
	const params = new URLSearchParams({
		limit: "50",
		include_total: "false",
		sort: "name.asc,id.asc",
	});
	if (cursor) params.set("cursor", cursor);
	const response = await fetch(
		`${hubuumBffPath(`/api/v1/${kind === "class" ? "classes" : "collections"}`)}?${params}`,
		{ credentials: "include", signal },
	);
	const payload: unknown = await response.json();
	if (!response.ok)
		throw new Error(
			getApiErrorMessage(payload, `Could not load ${kind} options.`),
		);
	return {
		items: expectArrayPayload<ResourceOption>(payload, `${kind} options`),
		nextCursor: response.headers.get("x-next-cursor"),
	};
}

export async function fetchResourceOption(
	kind: ResourceOptionKind,
	id: string,
	signal?: AbortSignal,
): Promise<ResourceOption> {
	if (!/^[1-9]\d*$/.test(id)) throw new Error("Choose a valid resource.");
	const response = await fetch(
		hubuumBffPath(
			`/api/v1/${kind === "class" ? "classes" : "collections"}/${id}${kind === "class" ? "?include=collection" : ""}`,
		),
		{ credentials: "include", signal },
	);
	const payload: unknown = await response.json();
	if (!response.ok)
		throw new Error(
			getApiErrorMessage(payload, `Could not load the selected ${kind}.`),
		);
	if (
		!payload ||
		typeof payload !== "object" ||
		!("id" in payload) ||
		!("name" in payload) ||
		typeof payload.name !== "string"
	)
		throw new Error("Unexpected resource response.");
	return payload as ResourceOption;
}

export async function fetchAllCollectionOptions(
	signal?: AbortSignal,
): Promise<Collection[]> {
	return collectAllCursorPages((cursor) =>
		fetchResourceOptions("collection", "", cursor, signal),
	);
}

export async function fetchAllClassOptions(
	signal?: AbortSignal,
): Promise<HubuumClassExpanded[]> {
	return collectAllCursorPages((cursor) =>
		fetchResourceOptions("class", "", cursor, signal),
	);
}
