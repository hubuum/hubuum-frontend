import { describe, expect, it } from "vitest";

import { buildReportQuery, parseReportQuery } from "@/lib/report-query";
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
});
