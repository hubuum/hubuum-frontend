import { describe, expect, it } from "vitest";

import { parseReportMaxAge } from "@/lib/report-max-age";

describe("report maximum age", () => {
	it("parses default, forced, and duration-based freshness", () => {
		expect(parseReportMaxAge(null)).toEqual({
			maxAgeMilliseconds: null,
			ok: true,
		});
		expect(parseReportMaxAge("")).toEqual({
			maxAgeMilliseconds: null,
			ok: true,
		});
		expect(parseReportMaxAge("0")).toEqual({
			maxAgeMilliseconds: 0,
			ok: true,
		});
		expect(parseReportMaxAge("15m")).toEqual({
			maxAgeMilliseconds: 15 * 60 * 1000,
			ok: true,
		});
	});

	it("rejects malformed and excessive durations", () => {
		expect(parseReportMaxAge("1.5h")).toMatchObject({ ok: false });
		expect(parseReportMaxAge("366d")).toEqual({
			message: "Maximum age cannot exceed 365d.",
			ok: false,
		});
	});
});
