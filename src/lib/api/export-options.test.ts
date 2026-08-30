import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClasses, getCollections } = vi.hoisted(() => ({
	getClasses: vi.fn(),
	getCollections: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1Classes: getClasses,
	getApiV1Collections: getCollections,
}));

import {
	fetchExportClasses,
	fetchExportCollections,
} from "@/lib/api/export-options";

function collection(id: number) {
	return {
		created_at: "2026-08-30T12:00:00Z",
		description: "",
		id,
		name: `collection-${id}`,
		parent_collection_id: null,
		revision: 1,
		updated_at: "2026-08-30T12:00:00Z",
	};
}

function hubuumClass(id: number) {
	return {
		collection: collection(id),
		created_at: "2026-08-30T12:00:00Z",
		description: "",
		id,
		json_schema: { type: "object" },
		name: `class-${id}`,
		revision: 1,
		updated_at: "2026-08-30T12:00:00Z",
		validate_schema: true,
	};
}

describe("export resource option loaders", () => {
	beforeEach(() => {
		getClasses.mockReset();
		getCollections.mockReset();
	});

	it("loads collections and classes beyond the first 250", async () => {
		getCollections
			.mockResolvedValueOnce({
				data: Array.from({ length: 250 }, (_, index) => collection(index + 1)),
				headers: new Headers({ "X-Next-Cursor": "collections-page-2" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [collection(251)],
				headers: new Headers(),
				status: 200,
			});
		getClasses
			.mockResolvedValueOnce({
				data: Array.from({ length: 250 }, (_, index) => hubuumClass(index + 1)),
				headers: new Headers({ "X-Next-Cursor": "classes-page-2" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [hubuumClass(251)],
				headers: new Headers(),
				status: 200,
			});

		const [collections, classes] = await Promise.all([
			fetchExportCollections(),
			fetchExportClasses(),
		]);

		expect(collections).toHaveLength(251);
		expect(classes).toHaveLength(251);
		expect(collections.at(-1)?.id).toBe(251);
		expect(classes.at(-1)?.id).toBe(251);
		expect(getCollections).toHaveBeenNthCalledWith(
			1,
			{
				cursor: undefined,
				include_total: false,
				limit: 250,
				sort: "id.asc",
			},
			{ credentials: "include" },
		);
		expect(getCollections).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ cursor: "collections-page-2" }),
			{ credentials: "include" },
		);
		expect(getClasses).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ cursor: "classes-page-2" }),
			{ credentials: "include" },
		);
	});

	it("rejects a repeated cursor instead of hanging option workflows", async () => {
		getClasses
			.mockResolvedValueOnce({
				data: [hubuumClass(1)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [hubuumClass(2)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			});

		await expect(fetchExportClasses()).rejects.toThrow(
			"repeated next cursor",
		);
	});
});
