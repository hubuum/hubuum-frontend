import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(),
}));

vi.mock("@/lib/api/backend", () => ({
	backendFetchRaw: mocks.backendFetchRaw,
}));

import {
	invalidateBackendSessionValidation,
	validateBackendSession,
} from "@/lib/auth/backend-session-validation";

describe("backend session validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		[200, "valid"],
		[401, "expired"],
		[503, "unavailable"],
	] as const)("maps backend status %s to %s", async (status, expected) => {
		const sid = `status-${status}`;
		mocks.backendFetchRaw.mockResolvedValue(new Response(null, { status }));

		await expect(
			validateBackendSession({ sid, token: "backend-token" }),
		).resolves.toBe(expected);
		invalidateBackendSessionValidation(sid);
	});

	it("does not expire the session when the backend is unreachable", async () => {
		mocks.backendFetchRaw.mockRejectedValue(new Error("offline"));

		await expect(
			validateBackendSession({ sid: "offline", token: "backend-token" }),
		).resolves.toBe("unavailable");
		invalidateBackendSessionValidation("offline");
	});

	it("coalesces concurrent validation for one frontend session", async () => {
		let resolveResponse: ((response: Response) => void) | undefined;
		mocks.backendFetchRaw.mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					resolveResponse = resolve;
				}),
		);

		const first = validateBackendSession({
			sid: "concurrent",
			token: "backend-token",
		});
		const second = validateBackendSession({
			sid: "concurrent",
			token: "backend-token",
		});

		expect(mocks.backendFetchRaw).toHaveBeenCalledOnce();
		resolveResponse?.(new Response(null, { status: 200 }));
		await expect(Promise.all([first, second])).resolves.toEqual([
			"valid",
			"valid",
		]);
		invalidateBackendSessionValidation("concurrent");
	});

	it("does not reuse a completed successful validation", async () => {
		mocks.backendFetchRaw
			.mockResolvedValueOnce(new Response(null, { status: 200 }))
			.mockResolvedValueOnce(new Response(null, { status: 401 }));

		await expect(
			validateBackendSession({ sid: "revoked", token: "backend-token" }),
		).resolves.toBe("valid");
		await expect(
			validateBackendSession({ sid: "revoked", token: "backend-token" }),
		).resolves.toBe("expired");

		expect(mocks.backendFetchRaw).toHaveBeenCalledTimes(2);
		invalidateBackendSessionValidation("revoked");
	});
});
