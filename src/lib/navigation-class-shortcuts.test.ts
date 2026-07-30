import { describe, expect, it } from "vitest";
import { buildNavigationClassShortcuts } from "@/lib/navigation-class-shortcuts";
import type { PinnedItem, RecentItem } from "@/types/quick-access";

describe("buildNavigationClassShortcuts", () => {
	it("prioritizes pinned and recent classes before the fallback page", () => {
		const pinnedItems: PinnedItem[] = [
			{
				type: "object",
				id: 91,
				name: "Router A",
				classId: 9,
				className: "Routers",
				timestamp: 4,
			},
			{
				type: "class",
				id: 7,
				name: "Devices",
				timestamp: 3,
			},
		];
		const recentItems: RecentItem[] = [
			{ type: "class", id: 8, name: "Locations", timestamp: 2 },
			{ type: "class", id: 7, name: "Devices", timestamp: 1 },
		];

		expect(
			buildNavigationClassShortcuts({
				fallbackClasses: [
					{ id: 1, name: "Applications" },
					{ id: 7, name: "Devices" },
				],
				limit: 10,
				pinnedItems,
				recentItems,
			}),
		).toEqual([
			{ id: 9, name: "Routers" },
			{ id: 7, name: "Devices" },
			{ id: 8, name: "Locations" },
			{ id: 1, name: "Applications" },
		]);
	});

	it("caps the result and ignores object history without a class name", () => {
		expect(
			buildNavigationClassShortcuts({
				fallbackClasses: [
					{ id: 2, name: "B" },
					{ id: 3, name: "C" },
				],
				limit: 2,
				pinnedItems: [
					{
						type: "object",
						id: 41,
						name: "Unnamed class object",
						classId: 4,
						timestamp: 2,
					},
				],
				recentItems: [
					{ type: "object", id: 42, name: "Object", classId: 5, timestamp: 1 },
				],
			}),
		).toEqual([
			{ id: 2, name: "B" },
			{ id: 3, name: "C" },
		]);
	});
});
