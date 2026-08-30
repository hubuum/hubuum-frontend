import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAncestors, putParent } = vi.hoisted(() => ({
	getAncestors: vi.fn(),
	putParent: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1CollectionsByCollectionIdAncestors: getAncestors,
	putApiV1CollectionsByCollectionIdParent: putParent,
}));

import { moveCollectionToParent } from "@/lib/api/collection-moves";

describe("moveCollectionToParent", () => {
	beforeEach(() => {
		getAncestors.mockReset();
		putParent.mockReset();
	});

	it("rejects a descendant found beyond the first 250 ancestors", async () => {
		getAncestors.mockResolvedValue({
			data: Array.from({ length: 251 }, (_, index) => ({
				id: index === 250 ? 17 : index + 100,
			})),
			headers: new Headers(),
			status: 200,
		});

		await expect(moveCollectionToParent(17, 999)).rejects.toThrow(
			"A collection cannot be moved under one of its descendants.",
		);
		expect(getAncestors).toHaveBeenCalledWith(999, {
			credentials: "include",
		});
		expect(putParent).not.toHaveBeenCalled();
	});

	it("moves after validating the complete target ancestry", async () => {
		getAncestors.mockResolvedValue({
			data: [{ id: 1 }, { id: 2 }],
			headers: new Headers(),
			status: 200,
		});
		putParent.mockResolvedValue({
			data: {},
			headers: new Headers(),
			status: 202,
		});

		await moveCollectionToParent(17, 22);

		expect(putParent).toHaveBeenCalledWith(
			17,
			{ parent_collection_id: 22 },
			{ credentials: "include" },
		);
	});

	it("reports a useful error when the hierarchy changes during the move", async () => {
		getAncestors.mockResolvedValue({
			data: [],
			headers: new Headers(),
			status: 200,
		});
		putParent.mockResolvedValue({
			data: {},
			headers: new Headers(),
			status: 409,
		});

		await expect(moveCollectionToParent(17, 22)).rejects.toThrow(
			"The collection hierarchy changed or the selected parent is no longer valid. Refresh and try again.",
		);
	});
});
