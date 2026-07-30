import { describe, expect, it } from "vitest";

import { buildResourceSummary } from "@/lib/resource-summary";

describe("buildResourceSummary", () => {
	it("keeps loaded and exact total counts as separate readable segments", () => {
		expect(
			buildResourceSummary({
				loaded: 50,
				total: 273,
			}),
		).toEqual(["50 loaded", "273 total"]);
	});

	it("includes local filtering and selection without hiding the server total", () => {
		expect(
			buildResourceSummary({
				shown: 7,
				shownLabel: "shown on page",
				loaded: 50,
				total: 273,
				selected: 2,
			}),
		).toEqual([
			"7 shown on page",
			"50 loaded",
			"273 total",
			"2 selected",
		]);
	});

	it("supports scoped nouns, alternate total labels, and waiting states", () => {
		expect(
			buildResourceSummary({
				loaded: 4,
				loadedNoun: "groups",
				total: 12,
				totalLabel: "matches",
				details: ["depth 3"],
			}),
		).toEqual(["4 groups loaded", "12 matches", "depth 3"]);
		expect(buildResourceSummary({ status: "Waiting…" })).toEqual([
			"Waiting…",
		]);
	});
});
