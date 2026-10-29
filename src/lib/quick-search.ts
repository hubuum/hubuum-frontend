import type {
	UnifiedSearchKind,
	UnifiedSearchParams,
	UnifiedSearchResponse,
} from "@/lib/api/search";

export type QuickSearchDestination = {
	href: string;
	label: string;
	detail?: string;
};

export type QuickSearchResults = {
	items: QuickSearchDestination[];
	hasMore: boolean;
};

/** Preserve the first batch's order as later catalogs arrive. */
export function mergeQuickSearchResults(
	previous: QuickSearchDestination[],
	response: UnifiedSearchResponse,
): QuickSearchResults {
	const items = new Map(previous.map((item) => [item.href, item]));
	for (const collection of response.results.collections) {
		const href = `/collections/${collection.id}`;
		items.set(href, {
			href,
			label: collection.name,
			detail: `Collection #${collection.id}`,
		});
	}
	for (const resource of response.results.classes) {
		const href = `/classes/${resource.id}`;
		items.set(href, {
			href,
			label: resource.name,
			detail: `Class #${resource.id} · ${resource.collection.name} (#${resource.collection.id})`,
		});
	}
	for (const object of response.results.objects) {
		const href = `/objects/${object.hubuum_class_id}/${object.id}`;
		items.set(href, {
			href,
			label: object.name,
			detail: `Object #${object.id} · Class #${object.hubuum_class_id} · Collection #${object.collection_id}`,
		});
	}
	return {
		items: [...items.values()],
		hasMore: Object.values(response.next).some(Boolean),
	};
}

export function uniqueQuickSearchDestination(
	results: QuickSearchResults | undefined,
	complete: boolean,
): string | null {
	return complete && results?.items.length === 1 && !results.hasMore
		? results.items[0].href
		: null;
}

/** Keep workspace filters when searching from an existing results page. */
export function quickSearchParams(href: string): UnifiedSearchParams {
	const params = new URL(href, "http://localhost").searchParams;
	const kinds: UnifiedSearchKind[] = ["collection", "class", "object"];
	const selected = params
		.get("kinds")
		?.split(",")
		.map((kind) => kind.trim());
	return {
		q: params.get("q")?.trim() ?? "",
		kinds: selected ? kinds.filter((kind) => selected.includes(kind)) : kinds,
		limitPerKind: 5,
		searchClassSchema: params.get("search_class_schema") === "true",
		searchObjectData: params.get("search_object_data") === "true",
	};
}
