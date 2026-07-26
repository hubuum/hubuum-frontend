import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clearSessionCookie: vi.fn(),
	destroySession: vi.fn(),
	getSessionFromRequest: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
	clearSessionCookie: mocks.clearSessionCookie,
	destroySession: mocks.destroySession,
	getSessionFromRequest: mocks.getSessionFromRequest,
}));

import {
	rawReportErrorResponse,
	rawReportHeadResponse,
	requireRawReportSession,
} from "@/lib/raw-report-route";
import { RawReportError } from "@/lib/server-template-report";

const session = {
	sid: "session-id",
	token: "backend-token",
	username: "admin",
	createdAt: 1,
	lastSeen: 2,
};

describe("raw report route boundary", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("redirects unauthenticated bookmarks back through login", async () => {
		mocks.getSessionFromRequest.mockResolvedValue(null);
		const request = new NextRequest("http://localhost/reports/7?object_id=42");

		const response = await requireRawReportSession(request);

		expect(response).toBeInstanceOf(Response);
		expect((response as Response).status).toBe(307);
		expect((response as Response).headers.get("Location")).toBe(
			"http://localhost/login?next=%2Freports%2F7%3Fobject_id%3D42",
		);
	});

	it("clears an invalid backend session before returning to login", async () => {
		const request = new NextRequest("http://localhost/reports/7");

		const response = await rawReportErrorResponse(
			new RawReportError("Unauthorized", 401),
			request,
			session,
		);

		expect(mocks.destroySession).toHaveBeenCalledWith("session-id");
		expect(mocks.clearSessionCookie).toHaveBeenCalledWith(response, request);
		expect(response.status).toBe(307);
	});

	it("rejects HEAD without starting report generation", () => {
		const response = rawReportHeadResponse();

		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("GET");
	});
});
