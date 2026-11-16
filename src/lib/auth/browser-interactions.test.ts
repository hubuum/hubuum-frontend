import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginBrowserInteraction } from "./browser-interactions";

const mocks = vi.hoisted(() => ({
	fetch: vi.fn(),
	session: vi.fn(),
	save: vi.fn(),
	cookie: vi.fn(),
	admin: vi.fn(),
}));
vi.mock("@/lib/api/backend", () => ({ backendFetchRaw: mocks.fetch }));
vi.mock("@/lib/backend-target", () => ({
	getBackendTarget: async () => ({
		origin: "https://auth.example",
		revision: "accepted",
	}),
	sessionCredential: (session: { token: string }) => session.token,
}));
vi.mock("@/lib/env", () => ({
	getServerEnv: () => ({
		NODE_ENV: "production",
		AUTH_BFF_RETURN_TARGET_ID: "frontend",
	}),
}));
vi.mock("@/lib/auth/session", () => ({
	getSessionFromRequest: mocks.session,
	setSessionCookie: mocks.cookie,
	SESSION_COOKIE_NAME: "hubuum.sid",
}));
vi.mock("@/lib/auth/admin", () => ({
	probeAdminAccess: mocks.admin,
	discardAdminProbeResponse: vi.fn(),
}));
vi.mock("./pending-interactions", () => ({
	anonymousInteractionBrowser: async () =>
		"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
	createPendingInteraction: mocks.save,
}));
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const secret = `hai1.${"a".repeat(64)}`;
function begun() {
	return {
		id,
		redemption_secret: secret,
		interaction_version: 1,
		interval_seconds: 5,
		expires_at: new Date(Date.now() + 300_000).toISOString(),
		next: {
			kind: "browser",
			verification_uri: "https://auth.example/api/v1/auth/interactions/browser",
			user_code: "PUBLIC-CODE",
		},
	};
}
function request(body: unknown, origin = "https://console.example") {
	return new NextRequest(
		"https://console.example/_hubuum-bff/auth/interactions",
		{
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	);
}
describe("browser interaction begin boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.session.mockResolvedValue(null);
		mocks.save.mockResolvedValue(undefined);
	});
	it("rejects cross-origin login before contacting Hubuum", async () => {
		const response = await beginBrowserInteraction(
			request(
				{ provider_id: id, purpose: "login" },
				"https://attacker.example",
			),
		);
		expect(response.status).toBe(403);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
	it("keeps redemption authority private and returns only browser-bound public metadata", async () => {
		mocks.fetch.mockResolvedValueOnce(Response.json(begun(), { status: 201 }));
		const response = await beginBrowserInteraction(
			request({
				provider_id: id,
				purpose: "login",
				return_path: "//attacker.example",
			}),
		);
		const body = await response.text();
		expect(response.status).toBe(201);
		expect(body).not.toContain(secret);
		expect(JSON.parse(body)).toMatchObject({
			id,
			next: { user_code: "PUBLIC-CODE" },
		});
		expect(mocks.save).toHaveBeenCalledWith(
			expect.objectContaining({
				redemption_secret: secret,
				returnPath: "/app",
				browserId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
				nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
			}),
		);
		expect(mocks.fetch.mock.calls[0][1].token).toBeUndefined();
		expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
			delivery: "bff",
			interaction_mode: "browser",
			return_target_id: "frontend",
		});
		expect(mocks.cookie).toHaveBeenCalledOnce();
	});
	it("captures the exact mutation and original bearer for fresh approval", async () => {
		mocks.session.mockResolvedValue({
			sid: id,
			sessionId: id,
			token: "original-actor-credential",
		});
		mocks.fetch.mockResolvedValueOnce(Response.json(begun(), { status: 201 }));
		const mutation = {
			method: "POST",
			path: "/api/v1/iam/principals/42/tokens",
			body: { name: "prepared-token" },
		};
		const response = await beginBrowserInteraction(
			request({ provider_id: id, purpose: "credential_approval", mutation }),
		);
		expect(response.status).toBe(201);
		expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).operation).toEqual({
			kind: "create_token",
			principal_id: 42,
			token: mutation.body,
		});
		expect(mocks.save).toHaveBeenCalledWith(
			expect.objectContaining({
				intent: {
					purpose: "credential_approval",
					actor: { sid: id, sessionId: id, token: "original-actor-credential" },
					mutation,
				},
			}),
		);
		expect(await response.text()).not.toContain("original-actor-credential");
	});
	it("fences and cleans up malformed handoff metadata without storing or exposing the capability", async () => {
		const value = begun();
		value.next.verification_uri = "https://attacker.example/verify";
		mocks.fetch
			.mockResolvedValueOnce(Response.json(value, { status: 201 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(
				Response.json(
					{
						reason: "interaction_pending",
						error: "AuthenticationInteraction",
						message: "No issued session",
					},
					{ status: 409 },
				),
			);
		const response = await beginBrowserInteraction(
			request({ provider_id: id, purpose: "login" }),
		);
		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain(secret);
		expect(mocks.save).not.toHaveBeenCalled();
		expect(mocks.fetch.mock.calls.slice(1).map(([path]) => path)).toEqual([
			`/api/v1/auth/interactions/${id}/cancel`,
			`/api/v1/auth/interactions/${id}/issued-session/revoke`,
		]);
		expect(mocks.fetch.mock.calls[1][1]).toMatchObject({
			headers: { Authorization: `Hubuum-Interaction ${secret}` },
		});
	});
	it("does not downgrade an unsupported provider to a password login", async () => {
		mocks.fetch.mockResolvedValueOnce(
			Response.json(
				{
					reason: "capability_unsupported",
					message: "private-provider-detail",
				},
				{ status: 422 },
			),
		);
		const response = await beginBrowserInteraction(
			request({ provider_id: id, purpose: "login" }),
		);
		expect(response.status).toBe(422);
		expect(await response.text()).not.toContain("private-provider-detail");
		expect(mocks.fetch).toHaveBeenCalledOnce();
	});
});
