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
});
