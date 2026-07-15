import { describe, expect, it } from "vitest";

import type { ReportTemplate } from "@/lib/api/reporting";
import {
	filterReportTemplates,
	formatExportContentType,
	formatExportScope,
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
	});
});
