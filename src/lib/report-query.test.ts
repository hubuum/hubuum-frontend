import { describe, expect, it } from "vitest";

import {
	buildObjectReportQuery,
	buildReportQuery,
	parseReportQuery,
} from "@/lib/report-query";
import { SCOPE_QUERY_FIELDS } from "@/lib/report-scope-fields";

describe("report query builder", () => {
	it("round-trips supported filters and sorts", () => {
		const query = buildReportQuery(
			[{ field: "name", operator: "icontains", value: "srv" }],
			[{ field: "created_at", direction: "desc" }],
			"custom=value",
		);

		expect(query).toContain("name__icontains=srv");
		expect(query).toContain("sort=created_at.desc");
		const parsed = parseReportQuery(query, SCOPE_QUERY_FIELDS.objects_in_class);
		expect(parsed.filters).toEqual([
			{ field: "name", operator: "icontains", value: "srv" },
		]);
		expect(parsed.sorts).toEqual([{ field: "created_at", direction: "desc" }]);
		expect(parsed.advancedQuery).toContain("custom=value");
	});

	it("keeps unknown parameters in the advanced query", () => {
		const parsed = parseReportQuery(
			"custom=value&sort=unknown.desc",
			SCOPE_QUERY_FIELDS.collections,
		);
		expect(parsed.filters).toEqual([]);
		expect(parsed.advancedQuery).toContain("custom=value");
		expect(parsed.advancedQuery).toContain("sort=unknown.desc");
	});

	it("builds object export queries with nested server filters", () => {
		const query = buildObjectReportQuery(
			[
				{
					field: "json_data",
					operator: "gte",
					path: ["lifecycle", "commissioned_at"],
					value: "2022-07-24T00:00:00.000Z",
				},
				{
					field: "json_data",
					operator: "within_network",
					path: ["facts", "network", "default_ipv6", "address"],
					value: "2001:700:100::/48",
				},
			],
			[{ field: "name", direction: "asc" }],
			"include=computed&cursor=ignored",
		);
		const params = new URLSearchParams(query);

		expect(params.get("json_data__gte")).toBe(
			"lifecycle,commissioned_at=2022-07-24T00:00:00.000Z",
		);
		expect(params.get("json_data__within_network")).toBe(
			"facts,network,default_ipv6,address=2001:700:100::/48",
		);
		expect(params.get("sort")).toBe("name.asc");
		expect(params.get("include")).toBe("computed");
		expect(params.has("cursor")).toBe(false);
	});
});
