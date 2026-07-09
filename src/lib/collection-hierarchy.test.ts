import { describe, expect, it } from "vitest";

import type { Collection } from "@/lib/api/generated/models";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
	getCollectionPathLabel,
	getDescendantCollectionIds,
	getDuplicateCollectionNames,
	isRootCollection,
} from "@/lib/collection-hierarchy";

function collection(
	id: number,
	name: string,
	parentCollectionId: number | null = null,
): Collection {
	return {
		created_at: "2026-01-01T00:00:00Z",
		description: `${name} description`,
		id,
		name,
		parent_collection_id: parentCollectionId,
		updated_at: "2026-01-01T00:00:00Z",
	};
}

describe("collection hierarchy helpers", () => {
	it("builds sorted tree nodes and path labels", () => {
		const root = collection(1, "root");
		const platform = collection(2, "platform", 1);
		const prod = collection(3, "prod", 2);
		const alpha = collection(4, "alpha", 1);
		const hierarchy = buildCollectionHierarchy([prod, platform, root, alpha]);

		expect(hierarchy.flatNodes.map((node) => node.collection.name)).toEqual([
			"root",
			"alpha",
			"platform",
			"prod",
		]);
		expect(hierarchy.flatNodes.map((node) => node.depth)).toEqual([0, 1, 1, 2]);
		expect(getCollectionPathLabel(prod, hierarchy.byId)).toBe(
			"root (#1) / platform (#2) / prod (#3)",
		);
	});

	it("identifies roots and orphan collections", () => {
		const root = collection(1, "root");
		const orphan = collection(2, "orphan", 999);
		const hierarchy = buildCollectionHierarchy([orphan, root]);

		expect(isRootCollection(root)).toBe(true);
		expect(isRootCollection(orphan)).toBe(false);
		expect(hierarchy.orphanCollections).toEqual([orphan]);
		expect(hierarchy.flatNodes.map((node) => node.collection.id)).toEqual([1, 2]);
	});

	it("returns descendants without including the source collection", () => {
		const root = collection(1, "root");
		const platform = collection(2, "platform", 1);
		const prod = collection(3, "prod", 2);
		const sibling = collection(4, "sibling", 1);
		const hierarchy = buildCollectionHierarchy([root, platform, prod, sibling]);

		expect(
			Array.from(
				getDescendantCollectionIds(1, hierarchy.childrenByParentId),
			).sort(),
		).toEqual([2, 3, 4]);
		expect(Array.from(getDescendantCollectionIds(2, hierarchy.childrenByParentId))).toEqual([
			3,
		]);
	});

	it("detects duplicate names and formats path-aware options", () => {
		const root = collection(1, "root");
		const first = collection(2, "prod", 1);
		const second = collection(3, "Prod", 1);
		const hierarchy = buildCollectionHierarchy([root, first, second]);

		expect(getDuplicateCollectionNames([root, first, second])).toEqual(
			new Set(["prod"]),
		);
		expect(formatCollectionOption(first, hierarchy.byId)).toBe(
			"root (#1) / prod (#2)",
		);
	});
});
