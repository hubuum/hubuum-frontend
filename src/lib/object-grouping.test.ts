import { describe, expect, it } from "vitest";

import type { ObjectAggregateRow } from "@/lib/api/generated/models";
import {
	formatObjectAggregateDimension,
	formatObjectAggregateMeasure,
	formatObjectAggregateMeasureLabel,
	getObjectAggregatePathKey,
	groupObjectRows,
	indexObjectAggregateChildren,
	sortObjectAggregateRows,
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

	it("formats numeric aggregate measures and labels", () => {
		expect(formatObjectAggregateMeasure({ state: "value", value: 42.5 })).toBe(
			"42.5",
		);
		expect(formatObjectAggregateMeasure({ state: "empty" })).toBe("—");
		expect(formatObjectAggregateMeasureLabel("average", "CPU load")).toBe(
			"Average · CPU load",
		);
	});

	it("formats each ordered dimension, including collection names and absent values", () => {
		const collections = new Map([[12, "Servers"]]);
		const dimensions = [
			{ field: "json_data.os_major", state: "value" as const, value: 9 },
			{ field: "collection_id", state: "value" as const, value: 12 },
			{ field: "json_data.os_minor", state: "missing" as const },
		];
		expect(
			dimensions.map((dimension) =>
				formatObjectAggregateDimension(dimension, collections),
			),
		).toEqual(["9", "Servers (#12)", "(missing)"]);
		expect(
			formatObjectAggregateDimension(
				{ field: "collection_id", state: "value", value: 99 },
				collections,
			),
		).toBe("#99");
		expect(
			formatObjectAggregateDimension(
				{ field: "collection_id", state: "null" },
				collections,
			),
		).toBe("(null)");
	});
});

describe("natural aggregate sorting", () => {
	const row = (...values: (string | number)[]): ObjectAggregateRow => ({
		dimensions: values.map((value, index) => ({
			field: `json_data.field${index}`,
			state: "value",
			value,
		})),
		object_count: 10,
	});

	it.each([
		["numeric strings", ["10", "8", "9"], ["8", "9", "10"]],
		["versions", ["9.10", "9.2", "9.1"], ["9.1", "9.2", "9.10"]],
		[
			"labels",
			["RHEL 10", "RHEL 8", "RHEL 9"],
			["RHEL 8", "RHEL 9", "RHEL 10"],
		],
		["numbers", [10, 8, 9, -2, -10, 8.5], [-10, -2, 8, 8.5, 9, 10]],
	] as const)(
		"sorts %s in both directions without mutating the input",
		(_, values, expected) => {
			const rows = values.map((value) => row(value));
			for (const direction of ["asc", "desc"] as const) {
				expect(
					sortObjectAggregateRows(rows, direction).map(
						(row) => row.dimensions[0].value,
					),
				).toEqual(direction === "asc" ? expected : [...expected].reverse());
			}
			expect(rows.map((row) => row.dimensions[0].value)).toEqual(values);
		},
	);

	it("compares dimensions in grouping order and retains typed groups and subtotals", () => {
		const rows = [
			row("9", "10", "2"),
			row("8", "10", "1"),
			row("9", "2", "10"),
			row("9", "2", "8"),
			row(9, "2", "8"),
		];
		expect(sortObjectAggregateRows(rows, "asc")).toEqual([
			rows[1],
			rows[3],
			rows[4],
			rows[2],
			rows[0],
		]);
	});

	it("keeps null, missing and unavailable groups distinct and last in both directions", () => {
		const absent: ObjectAggregateRow[] = (
			["unavailable", "missing", "null"] as const
		).map((state) => ({
			dimensions: [{ field: "json_data.field0", state }],
			object_count: 1,
		}));
		for (const direction of ["asc", "desc"] as const) {
			const sorted = sortObjectAggregateRows([...absent, row("9")], direction);
			expect(sorted.map((row) => row.dimensions[0].state)).toEqual([
				"value",
				"null",
				"missing",
				"unavailable",
			]);
		}
	});
});

describe("aggregate tree paths", () => {
	it("keeps JSON types, empty strings, null, missing, and unavailable parents separate", () => {
		const parents = [
			{ field: "json_data.major", state: "value" as const, value: 9 },
			{ field: "json_data.major", state: "value" as const, value: "9" },
			{ field: "json_data.major", state: "value" as const, value: "" },
			{ field: "json_data.major", state: "null" as const },
			{ field: "json_data.major", state: "missing" as const },
			{ field: "json_data.major", state: "unavailable" as const },
		];
		const children = indexObjectAggregateChildren(
			parents.map((parent, index) => ({
				dimensions: [
					parent,
					{ field: "json_data.minor", state: "value", value: index },
				],
				object_count: index + 1,
			})),
		);
		expect(children.size).toBe(6);
		parents.forEach((parent, index) => {
			expect(
				children.get(getObjectAggregatePathKey([parent]))?.[0].object_count,
			).toBe(index + 1);
		});
	});

	it("matches structured parents across JSON key orders and keeps sibling server order", () => {
		const parent = {
			field: "json_data.major",
			state: "value" as const,
			value: { b: 2, a: [1, false] },
		};
		const children = indexObjectAggregateChildren(
			[3, 1, 2].map((minor) => ({
				dimensions: [
					parent,
					{ field: "json_data.minor", state: "value", value: minor },
				],
				object_count: 10,
			})),
		);
		const key = getObjectAggregatePathKey([
			{ ...parent, value: { a: [1, false], b: 2 } },
		]);
		expect(children.get(key)?.map((row) => row.dimensions[1].value)).toEqual([
			3, 1, 2,
		]);
	});

	it("indexes the full ordered parent path at the third level", () => {
		const parent = [
			{ field: "json_data.major", state: "value" as const, value: 9 },
			{ field: "json_data.minor", state: "value" as const, value: 1 },
		];
		const row = {
			dimensions: [
				...parent,
				{ field: "name", state: "value" as const, value: "host" },
			],
			object_count: 1,
		};
		const children = indexObjectAggregateChildren([row]);
		expect(children.get(getObjectAggregatePathKey(parent))).toEqual([row]);
		expect(children.has(getObjectAggregatePathKey(parent.slice(0, 1)))).toBe(
			false,
		);
	});
});
