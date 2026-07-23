import { describe, expect, it, vi } from "vitest";
import { collectAllCursorPages } from "@/lib/api/cursor-pages";

describe("collectAllCursorPages", () => {
	it("collects every page and supplies each opaque cursor unchanged", async () => {
		const loadPage = vi
			.fn()
			.mockResolvedValueOnce({ items: [1, 2], nextCursor: "cursor/one?x=1" })
			.mockResolvedValueOnce({ items: [3], nextCursor: "cursor two" })
			.mockResolvedValueOnce({ items: [4, 5], nextCursor: null });

		await expect(collectAllCursorPages(loadPage)).resolves.toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(loadPage.mock.calls).toEqual([
			[undefined],
			["cursor/one?x=1"],
			["cursor two"],
		]);
	});

	it("rejects a repeated next cursor instead of looping forever", async () => {
		const loadPage = vi
			.fn()
			.mockResolvedValueOnce({ items: [1], nextCursor: "repeat" })
			.mockResolvedValueOnce({ items: [2], nextCursor: "repeat" });

		await expect(collectAllCursorPages(loadPage)).rejects.toThrow(
			"repeated next cursor",
		);
	});
});
