import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(),
	createSession: vi.fn(async () => "session-id"),
	setSessionCookie: vi.fn(),
}));

vi.mock("@/lib/api/backend", () => ({
	backendFetchRaw: mocks.backendFetchRaw,
}));

vi.mock("@/lib/auth/session", () => ({
	createSession: mocks.createSession,
	setSessionCookie: mocks.setSessionCookie,
}));

import { POST } from "@/app/%5Fhubuum-bff/auth/login/route";

const loginUrl = "https://console.example/_hubuum-bff/auth/login";

function jsonLoginRequest(headers: HeadersInit = {}): NextRequest {
	return new NextRequest(loginUrl, {
		body: JSON.stringify({ name: "admin", password: "secret" }),
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		method: "POST",
	});
}

function formLoginRequest(headers: HeadersInit = {}): NextRequest {
	return new NextRequest(loginUrl, {
		body: new URLSearchParams({ username: "admin", password: "secret" }),
		headers,
		method: "POST",
	});
}

describe("login route request origin", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.backendFetchRaw
			.mockResolvedValueOnce(Response.json({ token: "issued-token" }))
			.mockResolvedValueOnce(
				Response.json({
					principal: { identity_scope: "local", name: "admin" },
				}),
			);
	});

	it("rejects a cross-origin JSON login before contacting Hubuum", async () => {
		const response = await POST(
			jsonLoginRequest({ Origin: "https://attacker.example" }),
		);

		expect(response.status).toBe(403);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it("rejects a same-site sibling form login", async () => {
		const response = await POST(
			formLoginRequest({
				Origin: "https://sibling.example",
				"Sec-Fetch-Site": "same-site",
			}),
		);

		expect(response.status).toBe(403);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it("rejects contradictory cross-site Fetch Metadata", async () => {
		const response = await POST(
			jsonLoginRequest({
				Origin: "https://console.example",
				"Sec-Fetch-Site": "cross-site",
			}),
		);

		expect(response.status).toBe(403);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
	});

	it("rejects login when both Origin and Fetch Metadata are missing", async () => {
		const response = await POST(jsonLoginRequest());

		expect(response.status).toBe(403);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
	});

	it("accepts a same-origin JSON login", async () => {
		const request = jsonLoginRequest({ Origin: "https://console.example" });
		const response = await POST(request);

		expect(response.status).toBe(200);
		expect(mocks.backendFetchRaw).toHaveBeenCalledTimes(2);
		expect(mocks.createSession).toHaveBeenCalledWith(
			"issued-token",
			"admin",
		);
		expect(mocks.setSessionCookie).toHaveBeenCalledWith(
			response,
			"session-id",
			request,
		);
	});

	it("accepts a same-origin form login", async () => {
		const response = await POST(
			formLoginRequest({ Origin: "https://console.example" }),
		);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/app");
		expect(mocks.backendFetchRaw).toHaveBeenCalledTimes(2);
		expect(mocks.createSession).toHaveBeenCalledOnce();
	});
});
