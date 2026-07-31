import { describe, expect, it } from "vitest";

import {
	buildObjectReportQuery,
	buildReportQuery,
	parseObjectReportQuery,
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

	it("round-trips the shared object server-filter grammar", () => {
		const query = buildObjectReportQuery(
			[
				{ field: "name", operator: "icontains", value: "edge" },
				{
					field: "updated_at",
					operator: "gte",
					value: "2026-01-01T00:00:00Z",
				},
				{
					field: "json_data",
					operator: "not_is_null",
					path: ["network", "address"],
					value: "",
				},
				{
					field: "computed",
					operator: "gte",
					value: "80",
					computedScope: "shared",
					computedKey: "health_score",
					computedResultType: "integer",
				},
			],
			[{ field: "updated_at", direction: "desc" }],
			"include=computed",
		);

		const parsed = parseObjectReportQuery(
			query,
			SCOPE_QUERY_FIELDS.objects_in_class,
			[
				{
					key: "health_score",
					scope: "shared",
					resultType: "integer",
				},
			],
		);

		expect(parsed.filters).toEqual([
			{ field: "name", operator: "icontains", value: "edge" },
			{
				field: "updated_at",
				operator: "gte",
				value: "2026-01-01T00:00:00Z",
			},
			{
				field: "json_data",
				operator: "not_is_null",
				path: ["network", "address"],
				value: "",
			},
			{
				field: "computed",
				operator: "gte",
				value: "80",
				computedScope: "shared",
				computedKey: "health_score",
				computedResultType: "integer",
			},
		]);
		expect(parsed.sorts).toEqual([{ field: "updated_at", direction: "desc" }]);
		expect(parsed.advancedQuery).toBe("include=computed");
	});

	it("keeps unavailable computed and malformed data filters advanced", () => {
		const parsed = parseObjectReportQuery(
			"computed.shared.missing__gte=1&json_data__gte=missing-separator",
			SCOPE_QUERY_FIELDS.objects_in_class,
		);

		expect(parsed.filters).toEqual([]);
		expect(parsed.advancedQuery).toContain("computed.shared.missing__gte=1");
		expect(parsed.advancedQuery).toContain("json_data__gte=missing-separator");
	});
});
