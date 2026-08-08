import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	destroySession: vi.fn(),
	getSessionFromServerCookies: vi.fn(),
	headers: vi.fn(),
	redirect: vi.fn((location: string) => {
		throw new Error(`redirect:${location}`);
	}),
	validateBackendSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/backend-session-validation", () => ({
	validateBackendSession: mocks.validateBackendSession,
}));
vi.mock("@/lib/auth/session", () => ({
	destroySession: mocks.destroySession,
	getSessionFromServerCookies: mocks.getSessionFromServerCookies,
}));

import { requireServerSession } from "@/lib/auth/guards";

const session = {
	createdAt: Date.now(),
	lastSeen: Date.now(),
	sid: "session-id",
	token: "backend-token",
	username: "admin",
};

describe("server session guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.headers.mockResolvedValue(
			new Headers({
				"x-correlation-id": "78a802c3-5427-4a0e-a64a-90189f393393",
				"x-hubuum-request-path": "/admin/users?limit=50",
			}),
		);
		mocks.getSessionFromServerCookies.mockResolvedValue(session);
		mocks.validateBackendSession.mockResolvedValue("valid");
	});

	it("returns a locally stored session after backend validation", async () => {
		await expect(requireServerSession()).resolves.toEqual(session);
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.redirect).not.toHaveBeenCalled();
	});

	it("continues without destroying the session during a backend outage", async () => {
		mocks.validateBackendSession.mockResolvedValue("unavailable");

		await expect(requireServerSession()).resolves.toEqual(session);
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.redirect).not.toHaveBeenCalled();
	});

	it("destroys an expired session and redirects directly to login", async () => {
		mocks.validateBackendSession.mockResolvedValue("expired");

		await expect(requireServerSession()).rejects.toThrow(
			"redirect:/login?error=session_expired&next=%2Fadmin%2Fusers%3Flimit%3D50",
		);
		expect(mocks.destroySession).toHaveBeenCalledWith("session-id");
		expect(mocks.redirect).toHaveBeenCalledWith(
			"/login?error=session_expired&next=%2Fadmin%2Fusers%3Flimit%3D50",
		);
	});

	it("redirects a missing frontend session without an expiry warning", async () => {
		mocks.getSessionFromServerCookies.mockResolvedValue(null);

		await expect(requireServerSession()).rejects.toThrow("redirect:/login");
		expect(mocks.validateBackendSession).not.toHaveBeenCalled();
		expect(mocks.destroySession).not.toHaveBeenCalled();
	});
});
