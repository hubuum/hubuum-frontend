import { describe, expect, it } from "vitest";

import {
	buildBookmarkableReportOverrides,
	type ReportConfiguratorValues,
} from "@/lib/report-configuration";

const values: ReportConfiguratorValues = {
	maxAge: "15m",
	maxItems: "25",
	maxOutputBytes: "262144",
	missingDataPolicy: "omit",
	objectId: "99",
	query: "name__icontains=edge",
};

describe("buildBookmarkableReportOverrides", () => {
	it("builds typed URL overrides without modifying the template", () => {
		expect(
			buildBookmarkableReportOverrides(
				values,
				{ scope_kind: "related_objects" },
				true,
			),
		).toEqual({
			limits: {
				max_items: 25,
				max_output_bytes: 262_144,
			},
			max_age: "15m",
			missing_data_policy: "omit",
			object_id: 99,
			query: "name__icontains=edge",
		});
	});

	it("omits object and query overrides when the report does not use them", () => {
		expect(
			buildBookmarkableReportOverrides(
				{ ...values, maxAge: "", maxItems: "", maxOutputBytes: "" },
				{ scope_kind: "objects_in_class" },
				false,
			),
		).toEqual({
			limits: {
				max_items: null,
				max_output_bytes: null,
			},
			max_age: null,
			missing_data_policy: "omit",
			object_id: null,
			query: null,
		});
	});

	it("requires a root object for related-object reports", () => {
		expect(() =>
			buildBookmarkableReportOverrides(
				{ ...values, objectId: "" },
				{ scope_kind: "related_objects" },
				true,
			),
		).toThrow(/root object/i);
	});

	it("rejects invalid limits and one-time zero-age bookmarks", () => {
		expect(() =>
			buildBookmarkableReportOverrides(
				{ ...values, maxItems: "12px" },
				{ scope_kind: "objects_in_class" },
				true,
			),
		).toThrow(/whole number/i);
		expect(() =>
			buildBookmarkableReportOverrides(
				{ ...values, maxAge: "0" },
				{ scope_kind: "objects_in_class" },
				true,
			),
		).toThrow(/Refresh now/);
	});
});
