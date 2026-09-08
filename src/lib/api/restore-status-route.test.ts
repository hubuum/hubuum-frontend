import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ backendFetchRaw: vi.fn() }));
vi.mock("@/lib/api/backend", () => mocks);

import { GET } from "@/app/%5Fhubuum-bff/hubuum/api/v1/restores/[restoreId]/status/route";

function request(capability = "restore-capability") {
	return new NextRequest(
		"https://hubuum.invalid/_hubuum-bff/hubuum/api/v1/restores/42/status",
		{
			headers: {
				"X-Hubuum-Restore-Capability": capability,
				Authorization: "Bearer browser-supplied",
				Cookie: "hubuum.sid=expired",
				"X-Correlation-ID": "restore-check",
			},
		},
	);
}

describe("capability-authenticated restore status", () => {
	beforeEach(() => vi.clearAllMocks());
	it("reads a terminal receipt without forwarding bearer credentials or cookies", async () => {
		mocks.backendFetchRaw.mockResolvedValue(
			Response.json({ id: 42, status: "succeeded" }),
		);
		const result = await GET(request(), {
			params: Promise.resolve({ restoreId: "42" }),
		});
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ id: 42, status: "succeeded" });
		expect(result.headers.get("cache-control")).toContain("no-store");
		expect(result.headers.get("X-Correlation-ID")).toBe("restore-check");
		const [path, options] = mocks.backendFetchRaw.mock.calls[0];
		expect(path).toBe("/api/v1/restores/42/status");
		expect(options.headers).toEqual({
			"X-Hubuum-Restore-Capability": "restore-capability",
		});
		expect(options.token).toBeUndefined();
	});
	it.each(["0", "-1", "../iam/me", "9007199254740992"])(
		"rejects invalid restore ID %s",
		async (restoreId) => {
			const result = await GET(request(), {
				params: Promise.resolve({ restoreId }),
			});
			expect(result.status).toBe(400);
			expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
		},
	);
	it("rejects a missing capability before contacting the backend", async () => {
		const result = await GET(request(""), {
			params: Promise.resolve({ restoreId: "42" }),
		});
		expect(result.status).toBe(400);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
	});
	it("preserves the backend's capability rejection", async () => {
		mocks.backendFetchRaw.mockResolvedValue(
			Response.json({ message: "Capability rejected" }, { status: 403 }),
		);
		const result = await GET(request(), {
			params: Promise.resolve({ restoreId: "42" }),
		});
		expect(result.status).toBe(403);
	});
	it("makes a temporarily unavailable backend retryable without expiring a session", async () => {
		mocks.backendFetchRaw.mockResolvedValue(
			new Response(null, { status: 503 }),
		);
		const result = await GET(request(), {
			params: Promise.resolve({ restoreId: "42" }),
		});
		expect(result.status).toBe(502);
	});
});
