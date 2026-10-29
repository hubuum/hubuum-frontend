import { describe, expect, it } from "vitest";
import type { UnifiedSearchResponse } from "@/lib/api/search";
import {
	mergeQuickSearchResults,
	quickSearchParams,
	uniqueQuickSearchDestination,
} from "@/lib/quick-search";

const collection = {
	id: 7,
	name: "Operations",
	description: "",
	revision: 1,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	parent_collection_id: null,
};
const hubuumClass = {
	id: 8,
	name: "Servers",
	description: "",
	revision: 1,
	collection,
	created_at: collection.created_at,
	updated_at: collection.updated_at,
	validate_schema: false,
};
function response(): UnifiedSearchResponse {
	return {
		query: "server",
		results: { collections: [], classes: [hubuumClass], objects: [] },
		next: { collections: null, classes: null, objects: null },
	};
}

describe("quick search", () => {
	it("keeps the first batch in place when a different catalog arrives", () => {
		const batch = response();
		const first = mergeQuickSearchResults([], batch);
		batch.results.collections = [collection];
		const next = mergeQuickSearchResults(first.items, batch);
		expect(next.items.map((item) => item.href)).toEqual([
			"/classes/8",
			"/collections/7",
		]);
		expect(mergeQuickSearchResults(next.items, batch).items).toEqual(
			next.items,
		);
		expect(next.items[0].detail).toContain("Operations (#7)");
	});
	it("uses resource identity rather than names to distinguish objects", () => {
		const batch = response();
		batch.results.classes = [];
		batch.results.objects = [8, 9].map((classId) => ({
			id: 1,
			name: "Same name",
			description: "",
			revision: 1,
			hubuum_class_id: classId,
			collection_id: 7,
			data: {},
			created_at: collection.created_at,
			updated_at: collection.updated_at,
		}));
		const result = mergeQuickSearchResults([], batch);
		expect(result.items.map((item) => item.href)).toEqual([
			"/objects/8/1",
			"/objects/9/1",
		]);
		expect(result.items[1].detail).toContain("Class #9 · Collection #7");
	});
	it("only identifies a unique destination after completion with no further pages", () => {
		const batch = response();
		let results = mergeQuickSearchResults([], batch);
		expect(uniqueQuickSearchDestination(results, false)).toBeNull();
		expect(uniqueQuickSearchDestination(results, true)).toBe("/classes/8");
		for (const kind of ["classes", "collections", "objects"] as const) {
			batch.next[kind] = "more";
			results = mergeQuickSearchResults([], batch);
			expect(uniqueQuickSearchDestination(results, true)).toBeNull();
			batch.next[kind] = null;
		}
		batch.results.collections = [collection];
		expect(
			uniqueQuickSearchDestination(mergeQuickSearchResults([], batch), true),
		).toBeNull();
		expect(
			uniqueQuickSearchDestination({ items: [], hasMore: false }, true),
		).toBeNull();
	});
	it("preserves the workspace search scope without broadening empty or unknown catalogs", () => {
		expect(quickSearchParams("/search?q=router%20%26%20switch")).toEqual({
			q: "router & switch",
			kinds: ["collection", "class", "object"],
			limitPerKind: 5,
			searchClassSchema: false,
			searchObjectData: false,
		});
		expect(
			quickSearchParams(
				"/search?q=router&kinds=object&search_object_data=true",
			),
		).toMatchObject({
			kinds: ["object"],
			searchObjectData: true,
		});
		expect(quickSearchParams("/search?kinds=").kinds).toEqual([]);
		expect(quickSearchParams("/search?kinds=unknown").kinds).toEqual([]);
	});
});
