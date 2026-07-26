import { describe, expect, it } from "vitest";

import { buildObjectAggregateSearchParams } from "@/lib/api/object-aggregates";

describe("object aggregate requests", () => {
	it("preserves ordered repeated dimensions and source filters", () => {
		const params = buildObjectAggregateSearchParams({
			groupBy: ["json_data.location,country", "computed.shared.lifecycle"],
			sort: "object_count.desc",
			limit: 50,
			cursor: "next-page",
			filters: [
				{
					field: "computed",
					computedScope: "shared",
					computedKey: "lifecycle",
					computedResultType: "string",
					operator: "equals",
					value: "active",
				},
			],
		});

		expect(params.getAll("group_by")).toEqual([
			"json_data.location,country",
			"computed.shared.lifecycle",
		]);
		expect(params.get("computed.shared.lifecycle__equals")).toBe("active");
		expect(params.get("sort")).toBe("object_count.desc");
		expect(params.get("cursor")).toBe("next-page");
	});

	it("preserves ordered numeric measures", () => {
		const params = buildObjectAggregateSearchParams({
			groupBy: ["collection_id"],
			measures: [
				{ operation: "sum", field: "json_data.cost" },
				{ operation: "average", field: "computed.shared.utilization" },
			],
			sort: "object_count.desc",
			limit: 50,
		});

		expect(params.getAll("aggregate")).toEqual([
			"sum:json_data.cost",
			"average:computed.shared.utilization",
		]);
	});

	it("supports a global measure without a group dimension", () => {
		const params = buildObjectAggregateSearchParams({
			groupBy: [],
			measures: [{ operation: "max", field: "json_data.capacity" }],
			sort: "object_count.desc",
			limit: 50,
		});

		expect(params.has("group_by")).toBe(false);
		expect(params.get("aggregate")).toBe("max:json_data.capacity");
	});

	it("rejects a request without a dimension or measure", () => {
		expect(() =>
			buildObjectAggregateSearchParams({
				groupBy: [],
				sort: "object_count.desc",
				limit: 50,
			}),
		).toThrowError("Choose at least one aggregate dimension or measure.");
	});
});
