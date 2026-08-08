import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clearSessionCookie: vi.fn(),
	destroySession: vi.fn(),
	getCurrentPrincipalId: vi.fn(),
	getSessionFromRequest: vi.fn(),
	loadUserSettingsSnapshotForPrincipal: vi.fn(),
}));

vi.mock("@/lib/auth/current-principal", () => ({
	getCurrentPrincipalId: mocks.getCurrentPrincipalId,
}));
vi.mock("@/lib/auth/session", () => ({
	clearSessionCookie: mocks.clearSessionCookie,
	destroySession: mocks.destroySession,
	getSessionFromRequest: mocks.getSessionFromRequest,
}));
vi.mock("@/lib/user-settings-server", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/user-settings-server")>()),
	loadUserSettingsSnapshotForPrincipal:
		mocks.loadUserSettingsSnapshotForPrincipal,
}));

import { GET } from "@/app/%5Fhubuum-bff/settings/route";
import { UserSettingsServerError } from "@/lib/user-settings-server";

const request = new NextRequest("http://localhost/_hubuum-bff/settings");
const session = {
	createdAt: Date.now(),
	lastSeen: Date.now(),
	sid: "session-id",
	token: "backend-token",
	username: "admin",
};

describe("settings route authentication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSessionFromRequest.mockResolvedValue(session);
		mocks.getCurrentPrincipalId.mockResolvedValue(17);
		mocks.loadUserSettingsSnapshotForPrincipal.mockResolvedValue({
			principalId: 17,
			schemaVersion: 1,
			settings: {},
		});
	});

	it("loads settings without repeating the session lookup", async () => {
		const response = await GET(request);

		expect(response.status).toBe(200);
		expect(mocks.getSessionFromRequest).toHaveBeenCalledOnce();
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
	});

	it("clears a stale cookie when no frontend session exists", async () => {
		mocks.getSessionFromRequest.mockResolvedValue(null);

		const response = await GET(request);

		expect(response.status).toBe(401);
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.clearSessionCookie).toHaveBeenCalledWith(response, request);
	});

	it("invalidates the frontend session when the principal is rejected", async () => {
		mocks.getCurrentPrincipalId.mockResolvedValue(null);

		const response = await GET(request);

		expect(response.status).toBe(401);
		expect(mocks.destroySession).toHaveBeenCalledWith("session-id");
		expect(mocks.clearSessionCookie).toHaveBeenCalledWith(response, request);
	});

	it("invalidates the frontend session when settings return 401", async () => {
		mocks.loadUserSettingsSnapshotForPrincipal.mockRejectedValue(
			new UserSettingsServerError("Unauthorized", 401),
		);

		const response = await GET(request);

		expect(response.status).toBe(401);
		expect(mocks.destroySession).toHaveBeenCalledWith("session-id");
		expect(mocks.clearSessionCookie).toHaveBeenCalledWith(response, request);
	});
});
