import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clearSessionCookie: vi.fn(),
	destroySession: vi.fn(),
	getBookmarkableTemplateReportStatus: vi.fn(),
	getSessionFromRequest: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
	clearSessionCookie: mocks.clearSessionCookie,
	destroySession: mocks.destroySession,
	getSessionFromRequest: mocks.getSessionFromRequest,
}));

vi.mock("@/lib/server-template-report", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/server-template-report")>()),
	getBookmarkableTemplateReportStatus:
		mocks.getBookmarkableTemplateReportStatus,
}));

import { POST } from "@/app/%5Fhubuum-bff/reports/latest/route";

describe("latest report result status route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSessionFromRequest.mockResolvedValue({
			sid: "session-id",
			token: "backend-token",
		});
	});

	it("returns current-revision result metadata without generating a report", async () => {
		mocks.getBookmarkableTemplateReportStatus.mockResolvedValue({
			generatedAt: "2026-07-28T20:01:00.000Z",
			outputExpiresAt: "2026-07-29T20:01:00.000Z",
			state: "available",
			taskId: 42,
		});
		const request = new NextRequest(
			"http://localhost/_hubuum-bff/reports/latest",
			{
				body: JSON.stringify({
					templates: [
						{
							revision: "2026-07-28T20:00:00.000Z",
							templateId: 7,
						},
					],
				}),
				headers: {
					"Content-Type": "application/json",
					Origin: "http://localhost",
				},
				method: "POST",
			},
		);

		const response = await POST(request);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			results: [
				{
					generatedAt: "2026-07-28T20:01:00.000Z",
					outputExpiresAt: "2026-07-29T20:01:00.000Z",
					state: "available",
					taskId: 42,
					templateId: 7,
				},
			],
		});
		expect(mocks.getBookmarkableTemplateReportStatus).toHaveBeenCalledWith(
			expect.objectContaining({
				revision: "2026-07-28T20:00:00.000Z",
				sessionId: "session-id",
				templateId: 7,
				token: "backend-token",
			}),
		);
	});

	it("rejects invalid requests and unauthenticated sessions", async () => {
		const invalidResponse = await POST(
			new NextRequest("http://localhost/_hubuum-bff/reports/latest", {
				body: JSON.stringify({ templates: [] }),
				headers: {
					"Content-Type": "application/json",
					Origin: "http://localhost",
				},
				method: "POST",
			}),
		);
		expect(invalidResponse.status).toBe(400);

		mocks.getSessionFromRequest.mockResolvedValue(null);
		const unauthorizedResponse = await POST(
			new NextRequest("http://localhost/_hubuum-bff/reports/latest", {
				body: JSON.stringify({
					templates: [
						{
							revision: "2026-07-28T20:00:00.000Z",
							templateId: 7,
						},
					],
				}),
				headers: {
					"Content-Type": "application/json",
					Origin: "http://localhost",
				},
				method: "POST",
			}),
		);
		expect(unauthorizedResponse.status).toBe(401);
		expect(mocks.getBookmarkableTemplateReportStatus).not.toHaveBeenCalled();
	});
});
