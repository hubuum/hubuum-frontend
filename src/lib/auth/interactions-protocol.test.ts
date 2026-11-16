import { describe, expect, it, vi } from "vitest";
import {
	authenticationResponseError,
	InteractionAccess,
	interactionRequest,
	parseAuthenticationMethods,
	parseInteractionBegun,
	readAuthenticationResponse,
} from "./interactions-protocol";

const backend = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api/backend", () => ({ backendFetchRaw: backend.fetch }));
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

describe("server-owned interaction protocol", () => {
	it("accepts the exact versioned public handoff", () => {
		expect(parseInteractionBegun(begun(), "https://auth.example").id).toBe(id);
	});
	it("does not implicitly serialize the redemption capability", () => {
		const access = InteractionAccess.parse(begun());
		expect(JSON.stringify(access)).not.toContain(secret);
		expect(String(access)).not.toContain(secret);
	});
	it.each([
		{ interaction_version: "1" },
		{ interaction_version: 2 },
		{ interval_seconds: 0 },
		{ interval_seconds: 1.5 },
		{ redemption_secret: "unvalidated-secret" },
		{ id: "00000000-0000-0000-0000-000000000000" },
		{ expires_at: new Date(Date.now() - 1000).toISOString() },
		{ expires_at: new Date(Date.now() + 700_000).toISOString() },
	])("rejects malformed binding metadata without exposing it: %j", (change) => {
		expect(() =>
			parseInteractionBegun({ ...begun(), ...change }, "https://auth.example"),
		).toThrow("invalid response");
	});
	it.each([
		"https://other.example/api/v1/auth/interactions/browser",
		"https://secret@auth.example/api/v1/auth/interactions/browser",
		"https://auth.example/api/v1/auth/interactions/browser?secret=value",
		"https://auth.example/api/v1/auth/interactions/browser#value",
		"https://auth.example/another-handler",
	])("rejects an unbound browser handoff %s", (verification_uri) => {
		const value = begun();
		expect(() =>
			parseInteractionBegun(
				{ ...value, next: { ...value.next, verification_uri } },
				"https://auth.example",
			),
		).toThrow();
	});
	it("rejects duplicate immutable discovery IDs", () => {
		const method = {
			provider_id: "local",
			name: "Local",
			kind: "local",
			interaction: "credentials",
			fresh_authentication: true,
			browser_available: true,
		};
		expect(() =>
			parseAuthenticationMethods({
				interaction_version: 1,
				methods: [method, method],
			}),
		).toThrow();
	});
	it("uses only the owned capability for one bounded completion request", async () => {
		backend.fetch.mockResolvedValueOnce(Response.json({ session_id: id }));
		const access = InteractionAccess.parse(begun());
		expect(access).not.toBeNull();
		if (!access) throw new Error("fixture access missing");
		await interactionRequest(
			{ origin: "https://auth.example", revision: "pinned" },
			access,
			"complete",
			"correlation",
		);
		expect(backend.fetch).toHaveBeenLastCalledWith(
			`/api/v1/auth/interactions/${id}/complete`,
			expect.objectContaining({
				headers: {
					Authorization: `Hubuum-Interaction ${secret}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ client_id: "hubuum-frontend" }),
				signal: expect.any(AbortSignal),
			}),
		);
		expect(backend.fetch.mock.calls.at(-1)?.[1]).not.toHaveProperty("token");
	});
	it("discards provider error detail and preserves a terminal typed reason", () => {
		const error = authenticationResponseError(
			new Response(null, { status: 403 }),
			{ reason: "access_denied", message: secret },
		);
		expect(error.reason).toBe("access_denied");
		expect(error.message).not.toContain(secret);
	});
	it("does not shorten Retry-After below the maximum interaction lifetime", () => {
		const error = authenticationResponseError(
			new Response(null, { status: 429, headers: { "Retry-After": "3600" } }),
			{ reason: "slow_down" },
		);
		expect(error.retryAfter).toBeGreaterThan(600);
	});
	it("bounds response consumption before parsing", async () => {
		await expect(
			readAuthenticationResponse(new Response("x".repeat(1024 * 1024 + 1))),
		).rejects.toThrow("invalid response");
	});
});
