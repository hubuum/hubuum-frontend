import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(async () => new Response(null, { status: 200 })),
	clearSessionCookie: vi.fn(),
	destroySession: vi.fn(async () => undefined),
	getSessionFromRequest: vi.fn(),
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
		mocks.getSessionFromRequest.mockResolvedValue(null);
		mocks.backendFetchRaw.mockResolvedValue(
			new Response(null, { status: 200 }),
		);
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
			{
				headers: { Origin: "http://localhost" },
				method: "POST",
			},
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

describe("all-token logout", () => {
	function request(origin = "http://localhost") {
		return new NextRequest(
			"http://localhost/_hubuum-bff/auth/logout?all=true",
			{ method: "POST", headers: { Origin: origin } },
		);
	}
	it("revokes upstream before destroying the local session", async () => {
		mocks.getSessionFromRequest.mockResolvedValue({
			sid: "local-session",
			token: "server-only-token",
		});
		const response = await POST(request());
		expect(response.status).toBe(200);
		expect(mocks.backendFetchRaw).toHaveBeenCalledWith(
			"/api/v1/auth/logout_all",
			expect.objectContaining({ method: "POST", token: "server-only-token" }),
		);
		expect(mocks.destroySession).toHaveBeenCalledWith("local-session");
		expect(mocks.clearSessionCookie).toHaveBeenCalled();
	});
	it("retains the session and reports failure if upstream revocation fails", async () => {
		vi.clearAllMocks();
		mocks.getSessionFromRequest.mockResolvedValue({
			sid: "local-session",
			token: "server-only-token",
		});
		mocks.backendFetchRaw.mockResolvedValueOnce(
			new Response(null, { status: 500 }),
		);
		expect((await POST(request())).status).toBe(502);
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
	});
	it("rejects cross-origin revocation before reading a session", async () => {
		vi.clearAllMocks();
		expect((await POST(request("https://untrusted.test"))).status).toBe(403);
		expect(mocks.getSessionFromRequest).not.toHaveBeenCalled();
	});
});
