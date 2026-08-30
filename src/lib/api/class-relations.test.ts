import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRelatedClasses, getRelatedRelations } = vi.hoisted(() => ({
	getRelatedClasses: vi.fn(),
	getRelatedRelations: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1ClassesByClassIdRelatedClasses: getRelatedClasses,
	getApiV1ClassesByClassIdRelatedRelations: getRelatedRelations,
}));

import { fetchClassRelations } from "@/lib/api/class-relations";

function relation(id: number) {
	return {
		created_at: "2026-08-30T08:00:00Z",
		from_hubuum_class_id: 7,
		id,
		revision: 1,
		to_hubuum_class_id: id + 100,
		updated_at: "2026-08-30T08:00:00Z",
	};
}

describe("fetchClassRelations", () => {
	beforeEach(() => {
		getRelatedClasses.mockReset();
		getRelatedRelations.mockReset();
	});

	it("collects every page without requesting exact totals", async () => {
		getRelatedRelations
			.mockResolvedValueOnce({
				data: [relation(1), relation(2)],
				headers: new Headers({ "X-Next-Cursor": "opaque/cursor?x=1" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [relation(3)],
				headers: new Headers(),
				status: 200,
			});

		await expect(fetchClassRelations(7)).resolves.toEqual([
			relation(1),
			relation(2),
			relation(3),
		]);
		expect(getRelatedRelations).toHaveBeenNthCalledWith(
			1,
			7,
			{
				cursor: undefined,
				include_total: false,
				limit: 250,
				sort: "id.asc",
			},
			{ credentials: "include" },
		);
		expect(getRelatedRelations).toHaveBeenNthCalledWith(
			2,
			7,
			expect.objectContaining({ cursor: "opaque/cursor?x=1" }),
			{ credentials: "include" },
		);
	});

	it("rejects a repeated next cursor", async () => {
		getRelatedRelations
			.mockResolvedValueOnce({
				data: [relation(1)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [relation(2)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			});

		await expect(fetchClassRelations(7)).rejects.toThrow(
			"repeated next cursor",
		);
	});
});
