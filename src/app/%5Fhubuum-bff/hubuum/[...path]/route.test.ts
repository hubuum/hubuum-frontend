import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clearSessionCookie: vi.fn(),
	discardAdminProbeResponse: vi.fn((response: Response) => {
		void response.body?.cancel();
	}),
	destroySession: vi.fn(),
	emitOperationalEvent: vi.fn(),
	fetch: vi.fn(),
	getSessionFromRequest: vi.fn(),
	probeAdminAccess: vi.fn(),
	validateBackendSession: vi.fn(),
}));

vi.mock("@/lib/api/backend", () => ({
	buildBackendUrl: (path: string) => `https://backend.example${path}`,
	getSafeBackendPathForLogs: (path: string) => path,
}));

vi.mock("@/lib/auth/admin", () => ({
	discardAdminProbeResponse: mocks.discardAdminProbeResponse,
	probeAdminAccess: mocks.probeAdminAccess,
}));

vi.mock("@/lib/auth/backend-session-validation", () => ({
	validateBackendSession: mocks.validateBackendSession,
}));

vi.mock("@/lib/auth/session", () => ({
	clearSessionCookie: mocks.clearSessionCookie,
	destroySession: mocks.destroySession,
	getSessionFromRequest: mocks.getSessionFromRequest,
}));

vi.mock("@/lib/operational-events", () => ({
	emitOperationalEvent: mocks.emitOperationalEvent,
	operationalErrorFields: () => ({}),
	operationalLevelForStatus: () => "info",
}));

import { GET } from "@/app/%5Fhubuum-bff/hubuum/[...path]/route";

const session = {
	createdAt: Date.now(),
	lastSeen: Date.now(),
	sid: "session-id",
	token: "backend-token",
	username: "admin",
};

function routeContext(path: string[]) {
	return { params: Promise.resolve({ path }) };
}

function request(path: string): NextRequest {
	return new NextRequest(`https://console.example/_hubuum-bff/hubuum/${path}`, {
		headers: {
			"X-Correlation-Id": "78a802c3-5427-4a0e-a64a-90189f393393",
		},
	});
}

describe("generic BFF proxy admin gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", mocks.fetch);
		mocks.getSessionFromRequest.mockResolvedValue(session);
		mocks.probeAdminAccess.mockResolvedValue({ status: "forbidden" });
		mocks.validateBackendSession.mockResolvedValue("valid");
	});

	it("rejects meta requests from an ordinary authenticated session", async () => {
		const response = await GET(
			request("api/v0/meta/counts"),
			routeContext(["api", "v0", "meta", "counts"]),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: "Forbidden",
			message: "Administrator access required.",
		});
		expect(mocks.probeAdminAccess).toHaveBeenCalledWith(
			"backend-token",
			"78a802c3-5427-4a0e-a64a-90189f393393",
		);
		expect(mocks.validateBackendSession).not.toHaveBeenCalled();
		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(mocks.emitOperationalEvent).toHaveBeenCalledWith(
			"warn",
			"bff.proxy.rejected",
			expect.objectContaining({ reason: "admin_required", status: 403 }),
		);
	});

	it("recognizes meta targets after canonical path normalization", async () => {
		const response = await GET(
			request("api/v0/other/../meta/db"),
			routeContext(["api", "v0", "other", "..", "meta", "db"]),
		);

		expect(response.status).toBe(403);
		expect(mocks.probeAdminAccess).toHaveBeenCalledOnce();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("confirms that a 401 probe belongs to a valid non-admin session", async () => {
		mocks.probeAdminAccess.mockResolvedValue({ status: "unauthorized" });

		const response = await GET(
			request("api/v0/meta/counts"),
			routeContext(["api", "v0", "meta", "counts"]),
		);

		expect(response.status).toBe(403);
		expect(mocks.validateBackendSession).toHaveBeenCalledOnce();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("clears an expired session instead of reporting an admin denial", async () => {
		mocks.probeAdminAccess.mockResolvedValue({ status: "unauthorized" });
		mocks.validateBackendSession.mockResolvedValue("expired");
		const incomingRequest = request("api/v0/meta/counts");

		const response = await GET(
			incomingRequest,
			routeContext(["api", "v0", "meta", "counts"]),
		);

		expect(response.status).toBe(401);
		expect(mocks.destroySession).toHaveBeenCalledWith("session-id");
		expect(mocks.clearSessionCookie).toHaveBeenCalledWith(
			response,
			incomingRequest,
		);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it.each([
		["failed admin probe", { status: "unavailable" }, "valid"],
		["unavailable session validation", { status: "unauthorized" }, "unavailable"],
	] as const)("returns 502 for %s", async (_label, probe, validation) => {
		mocks.probeAdminAccess.mockResolvedValue(probe);
		mocks.validateBackendSession.mockResolvedValue(validation);

		const response = await GET(
			request("api/v0/meta/counts"),
			routeContext(["api", "v0", "meta", "counts"]),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toEqual({
			error: "UpstreamUnavailable",
			message: "Failed to verify administrator access.",
		});
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("proxies meta requests for an administrator", async () => {
		const probeResponse = Response.json({ database: "ready" });
		mocks.probeAdminAccess.mockResolvedValue({
			response: probeResponse,
			status: "allowed",
		});
		mocks.fetch.mockResolvedValue(
			Response.json({ counts: { users: 4 } }, { status: 200 }),
		);

		const response = await GET(
			request("api/v0/meta/counts"),
			routeContext(["api", "v0", "meta", "counts"]),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ counts: { users: 4 } });
		expect(mocks.probeAdminAccess).toHaveBeenCalledOnce();
		expect(mocks.validateBackendSession).not.toHaveBeenCalled();
		expect(mocks.discardAdminProbeResponse).toHaveBeenCalledWith(
			probeResponse,
		);
		expect(mocks.fetch).toHaveBeenCalledOnce();
	});

	it("reuses the successful admin probe for an exact meta/db GET", async () => {
		mocks.probeAdminAccess.mockResolvedValue({
			response: Response.json({ database: "ready" }),
			status: "allowed",
		});

		const response = await GET(
			request("api/v0/meta/db"),
			routeContext(["api", "v0", "meta", "db"]),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ database: "ready" });
		expect(mocks.probeAdminAccess).toHaveBeenCalledOnce();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("does not run the admin check for non-meta API requests", async () => {
		mocks.fetch.mockResolvedValue(Response.json([{ id: 1 }], { status: 200 }));

		const response = await GET(
			request("api/v1/classes"),
			routeContext(["api", "v1", "classes"]),
		);

		expect(response.status).toBe(200);
		expect(mocks.probeAdminAccess).not.toHaveBeenCalled();
		expect(mocks.validateBackendSession).not.toHaveBeenCalled();
		expect(mocks.fetch).toHaveBeenCalledOnce();
	});
});
