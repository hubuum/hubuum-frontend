import { afterEach, describe, expect, it, vi } from "vitest";

import {
	clearPinnedItems,
	getPinnedItems,
	MAX_PINNED_ITEMS,
	pinItem,
} from "@/lib/pinned-items";
import { getRecentItems, removeRecentItem } from "@/lib/recent-items";

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

	it("removes one recent item without removing matching ids of other types", () => {
		const localStorage = createLocalStorage({
			"hubuum.recent-items": JSON.stringify([
				{ type: "collection", id: 8, name: "Collection", timestamp: 3 },
				{ type: "class", id: 8, name: "Class", timestamp: 2 },
				{ type: "task", id: 9, name: "Task", timestamp: 1 },
			]),
		});
		vi.stubGlobal("window", { localStorage });

		removeRecentItem("class", 8);

		expect(localStorage.setItem).toHaveBeenCalledWith(
			"hubuum.recent-items",
			JSON.stringify([
				{ type: "collection", id: 8, name: "Collection", timestamp: 3 },
				{ type: "task", id: 9, name: "Task", timestamp: 1 },
			]),
		);
	});

	it("normalizes legacy class shortcuts to one direct class pin", () => {
		const localStorage = createLocalStorage({
			"hubuum.pinned-items": JSON.stringify([
				{ type: "namespace", id: 7, name: "old namespace", timestamp: 1 },
				{ type: "object", id: 9, name: "broken object", timestamp: 2 },
				{
					type: "class",
					id: 10,
					name: "class",
					action: "create",
					timestamp: 4,
				},
				{ type: "class", id: 10, name: "class", action: "view", timestamp: 3 },
			]),
		});
		vi.stubGlobal("window", { localStorage });

		expect(getPinnedItems()).toEqual([
			{
				type: "class",
				id: 10,
				name: "class",
				timestamp: 4,
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
				timestamp: 4,
			},
		]);
	});

	it("keeps up to 30 pinned shortcuts", () => {
		const storedItems = Array.from(
			{ length: MAX_PINNED_ITEMS + 1 },
			(_, index) => ({
				type: "collection",
				id: index + 1,
				name: `Collection ${index + 1}`,
				timestamp: index + 1,
			}),
		);
		const localStorage = createLocalStorage({
			"hubuum.pinned-items": JSON.stringify(storedItems),
		});
		vi.stubGlobal("window", { localStorage });

		expect(getPinnedItems()).toHaveLength(30);
		expect(
			pinItem({
				type: "collection",
				id: MAX_PINNED_ITEMS + 2,
				name: "One too many",
			}),
		).toBe(false);
	});

	it("clears all pinned shortcuts", () => {
		const localStorage = createLocalStorage({
			"hubuum.pinned-items": JSON.stringify([
				{ type: "collection", id: 8, name: "Collection", timestamp: 1 },
			]),
		});
		vi.stubGlobal("window", {
			localStorage,
			dispatchEvent: vi.fn(),
		});

		clearPinnedItems();

		expect(localStorage.removeItem).toHaveBeenCalledWith("hubuum.pinned-items");
		expect(getPinnedItems()).toEqual([]);
	});
});
