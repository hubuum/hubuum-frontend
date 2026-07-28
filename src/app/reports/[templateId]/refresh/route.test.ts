import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	prepareBookmarkableTemplateReport: vi.fn(),
	rawReportErrorResponse: vi.fn(),
	requireRawReportSession: vi.fn(),
}));

vi.mock("@/lib/raw-report-route", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/raw-report-route")>()),
	rawReportErrorResponse: mocks.rawReportErrorResponse,
	requireRawReportSession: mocks.requireRawReportSession,
}));

vi.mock("@/lib/server-template-report", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/server-template-report")>()),
	prepareBookmarkableTemplateReport:
		mocks.prepareBookmarkableTemplateReport,
}));

import { GET } from "@/app/reports/[templateId]/refresh/route";

describe("report refresh action", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireRawReportSession.mockResolvedValue({
			correlationId: "correlation-id",
			session: {
				sid: "session-id",
				token: "backend-token",
			},
		});
		mocks.prepareBookmarkableTemplateReport.mockResolvedValue(undefined);
	});

	it("forces one generation and redirects to the clean bookmark URL", async () => {
		const request = new NextRequest(
			"http://localhost/reports/7/refresh?query=sort%3Dname&max_age=15m",
		);

		const response = await GET(request, {
			params: Promise.resolve({ templateId: "7" }),
		});

		expect(mocks.prepareBookmarkableTemplateReport).toHaveBeenCalledWith(
			expect.objectContaining({
				freshness: { maxAgeMilliseconds: 0 },
				request: { query: "sort=name" },
				sessionId: "session-id",
				templateId: 7,
				token: "backend-token",
			}),
		);
		expect(response.status).toBe(303);
		expect(response.headers.get("Location")).toBe(
			"http://localhost/reports/7?query=sort%3Dname&max_age=15m",
		);
		expect(response.headers.get("Server-Timing")).toMatch(
			/session;dur=\d+\.\d;desc="Session"/,
		);
		expect(response.headers.get("Server-Timing")).toMatch(
			/total;dur=\d+\.\d;desc="Total to headers"/,
		);
	});

	it("removes a legacy zero-age force flag from the resulting bookmark", async () => {
		const request = new NextRequest(
			"http://localhost/reports/7/refresh?max_age=0",
		);

		const response = await GET(request, {
			params: Promise.resolve({ templateId: "7" }),
		});

		expect(response.headers.get("Location")).toBe(
			"http://localhost/reports/7",
		);
	});
});
