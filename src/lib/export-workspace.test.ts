import { describe, expect, it } from "vitest";

import type { ReportTemplate } from "@/lib/api/reporting";
import {
	describeLatestReportResult,
	describeSavedReportQuery,
	filterReportTemplates,
	formatExportBytes,
	formatExportContentType,
	formatExportScope,
	getReportResultText,
	getBookmarkableReportHref,
	getExportResultHref,
	getReportConfigurationHref,
	getReportRefreshHref,
} from "@/lib/export-workspace";

const templates = [
	{
		id: 1,
		collection_id: 10,
		name: "Server inventory",
		description: "CSV for operations",
		content_type: "text/csv",
		kind: "export",
		scope_kind: "objects_in_class",
	},
	{
		id: 2,
		collection_id: 20,
		name: "HTML layout",
		description: "Shared report fragment",
		content_type: "text/html",
		kind: "fragment",
		scope_kind: null,
	},
] as ReportTemplate[];

describe("filterReportTemplates", () => {
	it("filters by collection and user-facing template text", () => {
		expect(filterReportTemplates(templates, { collectionId: 10 })).toEqual([
			templates[0],
		]);
		expect(filterReportTemplates(templates, { query: "OPERATIONS" })).toEqual([
			templates[0],
		]);
		expect(filterReportTemplates(templates, { query: "fragment" })).toEqual([
			templates[1],
		]);
	});

	it("returns every template when filters are blank", () => {
		expect(filterReportTemplates(templates, { query: "   " })).toEqual(
			templates,
		);
	});
});

describe("export labels", () => {
	it("formats API scope and content-type values for people", () => {
		expect(formatExportScope("objects_in_class")).toBe("Objects from a class");
		expect(formatExportContentType("text/csv")).toBe("CSV");
		expect(formatExportBytes(1024)).toBe("1.0 KiB");
		expect(formatExportBytes(1024 * 1024)).toBe("1.00 MiB");
	});

	it("normalizes text and JSON report results for display", () => {
		expect(
			getReportResultText({
				contentType: "text/plain",
				warningCount: 0,
				truncated: false,
				json: null,
				text: "Inventory",
			}),
		).toBe("Inventory");
		expect(
			getReportResultText({
				contentType: "application/json",
				warningCount: 0,
				truncated: false,
				json: {
					items: [],
					meta: {
						content_type: "application/json",
						count: 0,
						scope: { kind: "collections" },
						truncated: false,
					},
					warnings: [],
				},
				text: null,
			}),
		).toContain('"items": []');
	});

	it("describes the current template result without confusing it with template updates", () => {
		expect(
			describeLatestReportResult({
				status: {
					generatedAt: "2026-07-28T20:01:00.000Z",
					outputExpiresAt: "2026-07-29T20:01:00.000Z",
					state: "available",
					taskId: 42,
					templateId: 7,
				},
			}),
		).toEqual({
			hint: expect.stringContaining("Stored output is available until"),
			label: expect.stringMatching(/^Latest export: /),
		});
		expect(
			describeLatestReportResult({
				status: {
					generatedAt: "2026-07-28T20:01:00.000Z",
					outputExpiresAt: "2026-07-29T20:01:00.000Z",
					state: "expired",
					taskId: 42,
					templateId: 7,
				},
			}).label,
		).toContain("expired");
		expect(describeLatestReportResult({ status: null })).toEqual({
			hint: expect.stringContaining("first result"),
			label: "Latest export: none yet",
		});
	});

	it("describes saved filters and sorting without exposing query syntax", () => {
		expect(
			describeSavedReportQuery(
				"name__icontains=old+machine&collection_id=2&sort=updated_at.desc",
			),
		).toEqual({
			hint: "Filters — Name contains, ignoring case “old machine”; Collection ID equals “2”. Sort — Updated At descending.",
			label: "Saved query · 2 filters · 1 sort",
		});
		expect(
			describeSavedReportQuery(
				"json_data__gte=hardware%2Cmemory_gb%3D16&sort=name.asc",
			).hint,
		).toBe(
			"Filters — Data · Hardware · Memory Gb greater than or equal to “16”. Sort — Name ascending.",
		);
		expect(describeSavedReportQuery(null)).toEqual({
			hint: "No saved filters or sorting; the report uses the full selected scope.",
			label: "No filters",
		});
	});
});

describe("export result links", () => {
	it("builds raw task-result and bookmarkable template routes", () => {
		expect(getExportResultHref(42)).toBe("/reports/runs/42");
		expect(getBookmarkableReportHref(7)).toBe("/reports/7");
		expect(
			getBookmarkableReportHref(7, {
				query: "name__icontains=edge&sort=name",
				object_id: 99,
				missing_data_policy: "omit",
				limits: {
					max_items: 25,
					max_output_bytes: 262_144,
				},
				max_age: "15m",
			}),
		).toBe(
			"/reports/7?query=name__icontains%3Dedge%26sort%3Dname&object_id=99&missing_data_policy=omit&max_items=25&max_output_bytes=262144&max_age=15m",
		);
		expect(getBookmarkableReportHref(7, { max_age: 0 })).toBe(
			"/reports/7?max_age=0",
		);
		expect(getBookmarkableReportHref(7, { query: "" })).toBe(
			"/reports/7?query=",
		);
		expect(
			getReportConfigurationHref(7, {
				object_id: 99,
				max_age: "15m",
			}),
		).toBe("/exports/reports/7?object_id=99&max_age=15m");
		expect(
			getReportRefreshHref(7, {
				object_id: 99,
				max_age: "15m",
			}),
		).toBe("/reports/7/refresh?object_id=99&max_age=15m");
	});
});
