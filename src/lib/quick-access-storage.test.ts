import { afterEach, describe, expect, it, vi } from "vitest";

import { getPinnedItems } from "@/lib/pinned-items";
import { getRecentItems } from "@/lib/recent-items";

function createLocalStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));

	return {
		getItem: vi.fn((key: string) => store.get(key) ?? null),
		removeItem: vi.fn((key: string) => {
			store.delete(key);
		}),
		setItem: vi.fn((key: string, value: string) => {
			store.set(key, value);
		}),
	};
}

describe("quick access storage", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("drops stale recent item types and persists the cleaned list", () => {
		const localStorage = createLocalStorage({
			"hubuum.recent-items": JSON.stringify([
				{ type: "namespace", id: 7, name: "old namespace", timestamp: 1 },
				{ type: "collection", id: 8, name: "collection", timestamp: 2 },
				{ type: "object", id: 9, name: "broken object", timestamp: 3 },
			]),
		});
		vi.stubGlobal("window", { localStorage });

		expect(getRecentItems()).toEqual([
			{ type: "collection", id: 8, name: "collection", timestamp: 2 },
		]);
		expect(localStorage.setItem).toHaveBeenCalledWith(
			"hubuum.recent-items",
			JSON.stringify([
				{ type: "collection", id: 8, name: "collection", timestamp: 2 },
			]),
		);
	});

	it("drops malformed pinned shortcuts and keeps valid class actions", () => {
		const localStorage = createLocalStorage({
			"hubuum.pinned-items": JSON.stringify([
				{ type: "namespace", id: 7, name: "old namespace", timestamp: 1 },
				{ type: "object", id: 9, name: "broken object", timestamp: 2 },
				{ type: "class", id: 10, name: "class", action: "create", timestamp: 3 },
			]),
		});
		vi.stubGlobal("window", { localStorage });

		expect(getPinnedItems()).toEqual([
			{
				type: "class",
				id: 10,
				name: "class",
				action: "create",
				timestamp: 3,
			},
		]);
		expect(localStorage.setItem).toHaveBeenCalledOnce();
		const [key, payload] = localStorage.setItem.mock.calls[0];
		expect(key).toBe("hubuum.pinned-items");
		expect(JSON.parse(payload)).toEqual([
			{
				type: "class",
				id: 10,
				name: "class",
				action: "create",
				timestamp: 3,
			},
		]);
	});
});
