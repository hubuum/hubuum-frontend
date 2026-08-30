import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRelatedObjects, getRelatedRelations } = vi.hoisted(() => ({
	getRelatedObjects: vi.fn(),
	getRelatedRelations: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1ClassesByClassIdObjectsByObjectIdRelatedObjects: getRelatedObjects,
	getApiV1ClassesByClassIdObjectsByObjectIdRelatedRelations:
		getRelatedRelations,
}));

import {
	fetchObjectRelations,
	fetchRelatedObjects,
} from "@/lib/api/object-relations";

function relatedObject(id: number) {
	return {
		collection_id: 3,
		created_at: "2026-08-30T08:00:00Z",
		data: {},
		description: "",
		hubuum_class_id: 7,
		id,
		name: `object-${id}`,
		path: [1, id],
		revision: 1,
		updated_at: "2026-08-30T08:00:00Z",
	};
}

function objectRelation(id: number) {
	return {
		created_at: "2026-08-30T08:00:00Z",
		from_hubuum_object_id: 1,
		id,
		revision: 1,
		to_hubuum_object_id: id + 100,
		updated_at: "2026-08-30T08:00:00Z",
	};
}

describe("object relation loaders", () => {
	beforeEach(() => {
		getRelatedObjects.mockReset();
		getRelatedRelations.mockReset();
	});

	it("collects every related-object page with the requested traversal", async () => {
		getRelatedObjects
			.mockResolvedValueOnce({
				data: [relatedObject(2)],
				headers: new Headers({ "X-Next-Cursor": "objects-page-2" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [relatedObject(3)],
				headers: new Headers(),
				status: 200,
			});

		await expect(
			fetchRelatedObjects(7, 1, {
				depthLimit: 4,
				ignoredClassIds: [8, 9],
				includeSelfClass: true,
			}),
		).resolves.toEqual([relatedObject(2), relatedObject(3)]);
		expect(getRelatedObjects).toHaveBeenNthCalledWith(
			1,
			7,
			1,
			{
				cursor: undefined,
				depth__lte: 4,
				ignore_classes: "8,9",
				ignore_self_class: false,
				include_total: false,
				limit: 250,
				sort: "path.asc,id.asc",
			},
			{ credentials: "include" },
		);
		expect(getRelatedObjects).toHaveBeenNthCalledWith(
			2,
			7,
			1,
			expect.objectContaining({ cursor: "objects-page-2" }),
			{ credentials: "include" },
		);
	});

	it("collects every direct object-relation page", async () => {
		getRelatedRelations
			.mockResolvedValueOnce({
				data: [objectRelation(1)],
				headers: new Headers({ "X-Next-Cursor": "relations-page-2" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [objectRelation(2)],
				headers: new Headers(),
				status: 200,
			});

		await expect(fetchObjectRelations(7, 1)).resolves.toEqual([
			objectRelation(1),
			objectRelation(2),
		]);
		expect(getRelatedRelations).toHaveBeenNthCalledWith(
			1,
			7,
			1,
			{
				cursor: undefined,
				include_total: false,
				limit: 250,
				sort: "id.asc",
			},
			{ credentials: "include" },
		);
	});

	it("rejects a repeated object-relation cursor", async () => {
		getRelatedRelations
			.mockResolvedValueOnce({
				data: [objectRelation(1)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [objectRelation(2)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			});

		await expect(fetchObjectRelations(7, 1)).rejects.toThrow(
			"repeated next cursor",
		);
	});
});
