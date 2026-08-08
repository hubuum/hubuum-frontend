import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(),
}));

vi.mock("@/lib/api/backend", () => ({
	backendFetchRaw: mocks.backendFetchRaw,
}));

import { hasAdminAccess, probeAdminAccess } from "@/lib/auth/admin";

describe("admin access probe", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the successful probe response for request-local reuse", async () => {
		const response = Response.json({ database: "ready" });
		mocks.backendFetchRaw.mockResolvedValue(response);

		await expect(
			probeAdminAccess("backend-token", "correlation-id"),
		).resolves.toEqual({ status: "allowed", response });
		expect(response.bodyUsed).toBe(false);
		expect(mocks.backendFetchRaw).toHaveBeenCalledWith("/api/v0/meta/db", {
			correlationId: "correlation-id",
			method: "GET",
			token: "backend-token",
		});
	});

	it.each([
		[401, "unauthorized"],
		[403, "forbidden"],
		[500, "unavailable"],
	] as const)("maps backend status %s to %s", async (status, expected) => {
		const response = Response.json({ message: "failed" }, { status });
		mocks.backendFetchRaw.mockResolvedValue(response);

		await expect(probeAdminAccess("backend-token")).resolves.toEqual({
			status: expected,
		});
		expect(response.bodyUsed).toBe(true);
	});

	it("reports an unavailable probe when the backend cannot be reached", async () => {
		mocks.backendFetchRaw.mockRejectedValue(new Error("offline"));

		await expect(probeAdminAccess("backend-token")).resolves.toEqual({
			status: "unavailable",
		});
	});

	it("does not wait for response-body cancellation before denying access", async () => {
		const cancel = vi.fn(() => new Promise<void>(() => undefined));
		mocks.backendFetchRaw.mockResolvedValue({
			body: { cancel },
			status: 403,
		} as unknown as Response);

		await expect(probeAdminAccess("backend-token")).resolves.toEqual({
			status: "forbidden",
		});
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("keeps the existing boolean helper and consumes its probe body", async () => {
		const response = Response.json({ database: "ready" });
		mocks.backendFetchRaw.mockResolvedValue(response);

		await expect(hasAdminAccess("backend-token")).resolves.toBe(true);
		expect(response.bodyUsed).toBe(true);
	});
});
