import { describe, expect, it } from "vitest";

import {
	formatObjectAggregateDimension,
	groupObjectRows,
} from "@/lib/object-grouping";

describe("groupObjectRows", () => {
	it("groups equal values and keeps differently typed values separate", () => {
		const groups = groupObjectRows(
			[
				{ value: "1" },
				{ value: 1 },
				{ value: "1" },
				{ value: null },
				{ value: "" },
			],
			(row) => row.value,
			"count-desc",
		);

		expect(groups.map(({ label, count }) => ({ label, count }))).toEqual([
			{ label: "1", count: 2 },
			{ label: "(empty)", count: 2 },
			{ label: "1", count: 1 },
		]);
	});

	it("sorts aggregate counts with the group value as a stable tie breaker", () => {
		const rows = ["beta", "alpha", "beta", "gamma", "alpha", "beta"];

		expect(
			groupObjectRows(rows, (value) => value, "count-desc").map(
				({ label, count }) => [label, count],
			),
		).toEqual([
			["beta", 3],
			["alpha", 2],
			["gamma", 1],
		]);
		expect(
			groupObjectRows(rows, (value) => value, "count-asc").map(
				({ label, count }) => [label, count],
			),
		).toEqual([
			["gamma", 1],
			["alpha", 2],
			["beta", 3],
		]);
	});

	it("sorts group values naturally and leaves empty values last", () => {
		const rows = ["host-10", "host-2", undefined, "host-1"];

		expect(
			groupObjectRows(rows, (value) => value, "value-asc").map(
				(group) => group.label,
			),
		).toEqual(["host-1", "host-2", "host-10", "(empty)"]);
	});

	it("normalizes object key order for grouping", () => {
		const groups = groupObjectRows(
			[
				{ value: { name: "host", count: 2 } },
				{ value: { count: 2, name: "host" } },
			],
			(row) => row.value,
			"count-desc",
		);

		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(2);
	});

	it("keeps server aggregate value states distinct", () => {
		expect(formatObjectAggregateDimension({ state: "null" })).toBe("(null)");
		expect(formatObjectAggregateDimension({ state: "missing" })).toBe(
			"(missing)",
		);
		expect(formatObjectAggregateDimension({ state: "unavailable" })).toBe(
			"(unavailable)",
		);
		expect(
			formatObjectAggregateDimension({ state: "value", value: false }),
		).toBe("false");
	});
});
