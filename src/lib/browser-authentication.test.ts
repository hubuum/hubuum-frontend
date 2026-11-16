import { afterEach, describe, expect, it, vi } from "vitest";
import {
	approvalAuthenticationMethod,
	authenticationMessage,
	beginBrowserAuthentication,
	discoverBrowserAuthentication,
	waitForBrowserAuthentication,
	type BrowserAuthenticationFlow,
} from "./browser-authentication";

const provider = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const local = {
	provider_id: "local",
	name: "local",
	kind: "local",
	interaction: "credentials",
	fresh_authentication: true,
	browser_available: true,
};
const external = {
	provider_id: provider,
	name: "company",
	kind: "oidc",
	interaction: "browser",
	fresh_authentication: true,
	browser_available: true,
};
const discovery = (methods = [local, external]) =>
	Response.json({ interaction_version: 1, methods });
function flow(): BrowserAuthenticationFlow {
	return {
		id: provider,
		nonce: "a".repeat(43),
		purpose: "login",
		expires_at: new Date(Date.now() + 300_000).toISOString(),
		interval_seconds: 1,
		next: {
			kind: "browser",
			verification_uri: "https://auth.example/api/v1/auth/interactions/browser",
			user_code: "PUBLIC-CODE",
		},
	};
}
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("public browser authentication", () => {
	it("permits legacy discovery only for an actual missing contract", async () => {
		expect(
			await discoverBrowserAuthentication(
				undefined,
				vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
			),
		).toBeNull();
	});
	it.each([401, 403, 429, 500, 503])(
		"does not downgrade a discovery failure %s to passwords",
		async (status) => {
			await expect(
				discoverBrowserAuthentication(
					undefined,
					vi.fn().mockResolvedValue(
						Response.json(
							{
								reason: "provider_unavailable",
								message: "hidden-upstream-token",
							},
							{ status },
						),
					),
				),
			).rejects.toThrow("provider is unavailable");
		},
	);
	it("rejects ambiguous provider identity", async () => {
		await expect(
			discoverBrowserAuthentication(
				undefined,
				vi.fn().mockResolvedValue(discovery([local, external, external])),
			),
		).rejects.toThrow("could not be confirmed");
	});
	it.each([
		{ ...external, kind: "oauth", fresh_authentication: false },
		{ ...external, browser_available: false },
	])(
		"rejects unsupported or unavailable freshness without password probing",
		async (method) => {
			const fetcher = vi
				.fn()
				.mockResolvedValueOnce(discovery([local, method]))
				.mockResolvedValueOnce(
					Response.json({
						principal: {
							identity_scope: "company",
							kind: "human",
							name: "local/admin",
						},
						token: { scope: null },
					}),
				);
			vi.stubGlobal("fetch", fetcher);
			await expect(approvalAuthenticationMethod()).rejects.toThrow();
			expect(fetcher).toHaveBeenCalledTimes(2);
		},
	);
	it("selects freshness from the canonical scope rather than a formatted username", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(discovery())
				.mockResolvedValueOnce(
					Response.json({
						principal: {
							identity_scope: "company",
							kind: "human",
							name: "local/admin",
						},
						token: { scope: null },
					}),
				),
		);
		expect((await approvalAuthenticationMethod())?.provider_id).toBe(provider);
	});
	it.each([
		{ kind: "service_account", scope: null },
		{ kind: "human", scope: { permissions: ["ReadObject"] } },
	])(
		"rejects unsupported actor credentials without offering passwords",
		async ({ kind, scope }) => {
			const fetcher = vi
				.fn()
				.mockResolvedValueOnce(discovery())
				.mockResolvedValueOnce(
					Response.json({
						principal: { identity_scope: "local", kind },
						token: { scope },
					}),
				);
			vi.stubGlobal("fetch", fetcher);
			await expect(approvalAuthenticationMethod()).rejects.toThrow();
			expect(fetcher).toHaveBeenCalledTimes(2);
		},
	);
	it("does not infer a local identity from missing scope metadata", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(discovery())
				.mockResolvedValueOnce(Response.json({ principal: { name: "admin" } })),
		);
		await expect(approvalAuthenticationMethod()).rejects.toThrow(
			"identity could not be verified",
		);
	});
	it.each([
		{ purpose: "provider_verification" },
		{ redemption_secret: `hai1.${"a".repeat(64)}` },
		{
			next: {
				kind: "browser",
				verification_uri: "javascript:alert(1)",
				user_code: "PUBLIC",
			},
		},
	])(
		"rejects secret-bearing or purpose-confused public handoffs",
		async (change) => {
			const fetcher = vi
				.fn()
				.mockResolvedValue(
					Response.json({ ...flow(), ...change }, { status: 201 }),
				);
			await expect(
				beginBrowserAuthentication(
					{ provider_id: provider, purpose: "login" },
					undefined,
					fetcher,
				),
			).rejects.toThrow("could not be confirmed");
		},
	);
	it("sanitizes malformed JSON rather than rendering its secret-bearing parse error", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValue(
				new Response("secret-upstream-content", { status: 201 }),
			);
		await expect(
			beginBrowserAuthentication({ purpose: "login" }, undefined, fetcher),
		).rejects.toThrow("could not be confirmed");
	});
	it("serializes polling and honors the larger server Retry-After", async () => {
		vi.useFakeTimers();
		const pending = Response.json(
			{ state: "pending", interval_seconds: 1 },
			{ headers: { "Retry-After": "5" } },
		);
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(pending)
			.mockResolvedValueOnce(
				Response.json({
					state: "finished",
					purpose: "login",
					result: { authenticated: true },
				}),
			);
		const input = flow();
		const result = waitForBrowserAuthentication(
			input,
			new AbortController().signal,
			fetcher,
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(4999);
		expect(fetcher).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await result).toEqual({ authenticated: true });
		expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
			nonce: input.nonce,
		});
	});
	it("bounds polling by expiry even when Retry-After exceeds the remaining lifetime", async () => {
		vi.useFakeTimers();
		const input = flow();
		input.expires_at = new Date(Date.now() + 3000).toISOString();
		const fetcher = vi
			.fn()
			.mockResolvedValue(
				Response.json(
					{ reason: "slow_down" },
					{ status: 429, headers: { "Retry-After": "3600" } },
				),
			);
		const result = expect(
			waitForBrowserAuthentication(
				input,
				new AbortController().signal,
				fetcher,
			),
		).rejects.toThrow("expired");
		await vi.advanceTimersByTimeAsync(3001);
		await result;
		expect(fetcher).toHaveBeenCalledOnce();
	});
	it("stops an aborted wait before any backend poll", async () => {
		vi.useFakeTimers();
		const controller = new AbortController(),
			fetcher = vi.fn();
		const result = expect(
			waitForBrowserAuthentication(flow(), controller.signal, fetcher),
		).rejects.toThrow();
		controller.abort();
		await result;
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("maps only closed outcomes to user-visible text", () => {
		expect(
			authenticationMessage({
				reason: "access_denied",
				message: "private-provider-token",
			}),
		).toContain("denied");
		expect(authenticationMessage("private-provider-token")).not.toContain(
			"private-provider-token",
		);
	});
});
