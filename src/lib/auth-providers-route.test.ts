import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(),
}));

vi.mock("@/lib/api/backend", () => ({
	backendFetchRaw: mocks.backendFetchRaw,
}));

import { GET } from "@/app/%5Fhubuum-bff/auth/providers/route";

function request() {
	return new NextRequest("http://localhost/_hubuum-bff/auth/providers");
}

describe("public auth provider BFF", () => {
	afterEach(() => {
		mocks.backendFetchRaw.mockReset();
	});

	it("returns normalized providers from the public backend endpoint", async () => {
		mocks.backendFetchRaw.mockResolvedValue(
			Response.json({ providers: ["local", " directory ", "directory"] }),
		);

		const response = await GET(request());

		expect(mocks.backendFetchRaw).toHaveBeenCalledWith(
			"/api/v0/auth/providers",
			expect.objectContaining({ method: "GET" }),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({
			providers: ["local", "directory"],
		});
	});

	it("propagates a backend 404 so the login form can fall back", async () => {
		mocks.backendFetchRaw.mockResolvedValue(
			Response.json({ message: "Not found" }, { status: 404 }),
		);

		const response = await GET(request());

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			message: "Provider discovery is unavailable.",
		});
	});

	it("rejects malformed success payloads", async () => {
		mocks.backendFetchRaw.mockResolvedValue(
			Response.json({ providers: ["local", 42] }),
		);

		const response = await GET(request());

		expect(response.status).toBe(502);
	});

	it("returns a service-unavailable response on connection failure", async () => {
		mocks.backendFetchRaw.mockRejectedValue(new Error("offline"));

		const response = await GET(request());

		expect(response.status).toBe(503);
	});
});
