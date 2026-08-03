import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(async () => new Response(null, { status: 200 })),
	clearSessionCookie: vi.fn(),
	destroySession: vi.fn(async () => undefined),
	getSessionFromRequest: vi.fn(async () => null),
}));

vi.mock("@/lib/api/backend", () => ({
	backendFetchRaw: mocks.backendFetchRaw,
}));

vi.mock("@/lib/auth/session", () => ({
	clearSessionCookie: mocks.clearSessionCookie,
	destroySession: mocks.destroySession,
	getSessionFromRequest: mocks.getSessionFromRequest,
}));

import { GET, POST } from "@/app/%5Fhubuum-bff/auth/logout/route";

describe("logout route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects GET without reading or destroying the session", async () => {
		const response = await GET(
			new NextRequest("http://localhost/_hubuum-bff/auth/logout"),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(await response.json()).toEqual({
			error: "MethodNotAllowed",
			message: "Use POST to sign out.",
		});
		expect(mocks.getSessionFromRequest).not.toHaveBeenCalled();
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
	});

	it("keeps POST logout idempotent when no session exists", async () => {
		const request = new NextRequest(
			"http://localhost/_hubuum-bff/auth/logout",
			{ method: "POST" },
		);
		const response = await POST(request);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ message: "Logged out." });
		expect(mocks.getSessionFromRequest).toHaveBeenCalledWith(request);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.clearSessionCookie).toHaveBeenCalledWith(response, request);
	});
});
