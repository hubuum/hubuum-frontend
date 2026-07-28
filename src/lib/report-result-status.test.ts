import { describe, expect, it } from "vitest";

import {
	parseReportResultStatusRequest,
	parseReportResultStatusResponse,
} from "@/lib/report-result-status";

describe("report result status contracts", () => {
	it("accepts bounded template revisions and result metadata", () => {
		expect(
			parseReportResultStatusRequest({
				templates: [
					{
						revision: "2026-07-28T20:00:00.000Z",
						templateId: 7,
					},
				],
			}),
		).toEqual([
			{
				revision: "2026-07-28T20:00:00.000Z",
				templateId: 7,
			},
		]);
		expect(
			parseReportResultStatusResponse({
				results: [
					{
						generatedAt: "2026-07-28T20:01:00.000Z",
						outputExpiresAt: "2026-07-29T20:01:00.000Z",
						state: "available",
						taskId: 42,
						templateId: 7,
					},
				],
			}),
		).toEqual([
			{
				generatedAt: "2026-07-28T20:01:00.000Z",
				outputExpiresAt: "2026-07-29T20:01:00.000Z",
				state: "available",
				taskId: 42,
				templateId: 7,
			},
		]);
	});

	it("rejects duplicate templates, invalid dates, and unknown states", () => {
		expect(
			parseReportResultStatusRequest({
				templates: [
					{ revision: "not-a-date", templateId: 7 },
					{ revision: "2026-07-28T20:00:00Z", templateId: 7 },
				],
			}),
		).toBeNull();
		expect(
			parseReportResultStatusResponse({
				results: [
					{
						generatedAt: null,
						outputExpiresAt: null,
						state: "stale",
						taskId: null,
						templateId: 7,
					},
				],
			}),
		).toBeNull();
	});
});
