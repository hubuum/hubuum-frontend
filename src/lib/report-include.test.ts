import { describe, expect, it } from "vitest";

import {
	applyMinimumIncludeDepths,
	buildIncludeFromRows,
	buildRelatedClassMinimumDepths,
	minimumIncludeDepthFromPath,
	newIncludeRow,
} from "@/lib/report-include";

function includeRow(
	classId: string,
	maxDepth = "",
): ReturnType<typeof newIncludeRow> {
	return {
		...newIncludeRow("row-1"),
		alias: "rooms",
		classId,
		maxDepth,
	};
}

describe("related include depth", () => {
	it("derives relation hops from connected-class paths", () => {
		expect(minimumIncludeDepthFromPath([10, 30])).toBe(1);
		expect(minimumIncludeDepthFromPath([10, 20, 30])).toBe(2);
		expect(minimumIncludeDepthFromPath([])).toBeNull();
		expect(minimumIncludeDepthFromPath([10, 0])).toBeNull();
	});

	it("keeps the shortest path when a class appears more than once", () => {
		const minimums = buildRelatedClassMinimumDepths([
			{ id: 30, path: [10, 40, 20, 30] },
			{ id: 20, path: [10, 20] },
			{ id: 30, path: [10, 20, 30] },
		]);

		expect([...minimums.entries()]).toEqual([
			[30, 2],
			[20, 1],
		]);
	});

	it("raises a blank or insufficient field as soon as a distant class is selected", () => {
		const minimums = new Map([
			[20, 1],
			[30, 2],
		]);

		expect(applyMinimumIncludeDepths([includeRow("30")], minimums)[0])
			.toMatchObject({
				classId: "30",
				maxDepth: "2",
			});
		expect(applyMinimumIncludeDepths([includeRow("30", "1")], minimums)[0])
			.toMatchObject({
				maxDepth: "2",
			});
		expect(applyMinimumIncludeDepths([includeRow("30", "4")], minimums)[0])
			.toMatchObject({
				maxDepth: "4",
			});
		expect(applyMinimumIncludeDepths([includeRow("20")], minimums)[0])
			.toMatchObject({
				maxDepth: "",
			});
	});

	it("rejects saved includes below the selected class minimum", () => {
		const requirements = {
			minimumDepthByClassId: new Map([[30, 2]]),
			requireKnownClassDepth: true,
		};

		expect(buildIncludeFromRows([includeRow("30")], requirements)).toEqual({
			error: expect.stringMatching(/at least 2/i),
		});
		expect(
			buildIncludeFromRows([includeRow("30", "1")], requirements),
		).toEqual({
			error: expect.stringMatching(/at least 2/i),
		});
		expect(
			buildIncludeFromRows([includeRow("30", "2")], requirements),
		).toEqual({
			include: {
				related_objects: {
					rooms: expect.objectContaining({
						class_id: 30,
						max_depth: 2,
					}),
				},
			},
		});
	});

	it("rejects disconnected and unsupported-depth targets when verification is required", () => {
		expect(
			buildIncludeFromRows([includeRow("99")], {
				minimumDepthByClassId: new Map([[30, 2]]),
				requireKnownClassDepth: true,
			}),
		).toEqual({
			error: expect.stringMatching(/connected/i),
		});
		expect(
			buildIncludeFromRows([includeRow("30", "10")], {
				minimumDepthByClassId: new Map([[30, 11]]),
				requireKnownClassDepth: true,
			}),
		).toEqual({
			error: expect.stringMatching(/maximum supported depth is 10/i),
		});
	});

	it("rejects partially numeric include inputs", () => {
		expect(buildIncludeFromRows([includeRow("30px")])).toEqual({
			error: expect.stringMatching(/needs a class/i),
		});
		expect(
			buildIncludeFromRows([
				{ ...includeRow("30"), limit: "5px", maxDepth: "" },
			]),
		).toEqual({
			error: expect.stringMatching(/limit must be/i),
		});
		expect(
			buildIncludeFromRows([
				{ ...includeRow("30"), limit: "", maxDepth: "2px" },
			]),
		).toEqual({
			error: expect.stringMatching(/max depth must be/i),
		});
	});
});
