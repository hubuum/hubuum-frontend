import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCredentials } from "@/test/session-fixtures";
import { completeBrowserInteraction } from "./complete-browser-interaction";
import { InteractionAccess } from "./interactions-protocol";

const mocks = vi.hoisted(() => ({
	fetch: vi.fn(),
	acquire: vi.fn(),
	handoff: vi.fn(),
	session: vi.fn(),
	binding: vi.fn(),
	create: vi.fn(),
	destroy: vi.fn(),
	cookie: vi.fn(),
	cleanup: vi.fn(),
	finish: vi.fn(),
	set: vi.fn(),
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
		SESSION_PREFIX: "test:",
		AUTH_BFF_RETURN_TARGET_ID: "frontend",
	}),
}));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({ set: mocks.set }),
}));
vi.mock("@/lib/auth/session", () => ({
	getSessionFromRequest: mocks.session,
	readInteractionSessionBinding: mocks.binding,
	createSession: mocks.create,
	destroySession: mocks.destroy,
	setSessionCookie: mocks.cookie,
	SESSION_COOKIE_NAME: "hubuum.sid",
}));
vi.mock("./pending-interactions", () => ({
	ClaimedInteraction: { acquire: mocks.acquire },
	CompletedLoginHandoff: { acquire: mocks.handoff },
	OwnedInteractionPoll: { acquire: vi.fn() },
	readInteractionResult: vi.fn(),
	anonymousInteractionBrowser: vi.fn(),
	createPendingInteraction: vi.fn(),
}));
vi.mock("./browser-interactions", async (original) => ({
	...(await original<typeof import("./browser-interactions")>()),
	cleanupInteraction: mocks.cleanup,
}));

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const browserId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const sessionId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const nonce = "a".repeat(43);
const proof = `hai1.${"a".repeat(64)}`;
const approval = `hca1.${"b".repeat(64)}`;
const expires = "2027-02-04T12:34:56.123456";
function request() {
	return new NextRequest(
		`https://console.example/_hubuum-bff/auth/interactions/return?interaction_id=${id}&nonce=${nonce}`,
		{ headers: { Cookie: `hubuum.sid=${browserId}` } },
	);
}
function claimed(intent: object) {
	return {
		id,
		browserId,
		target: { origin: "https://auth.example", revision: "accepted" },
		providerId: id,
		intent,
		returnPath: "/objects",
		access: InteractionAccess.parse({ id, redemption_secret: proof }),
		finish: mocks.finish,
	};
}
function freshIntent() {
	return {
		purpose: "credential_approval",
		actor: { sid: browserId, sessionId, token: "original-actor-credential" },
		mutation: {
			method: "POST",
			path: "/api/v1/iam/principals/42/tokens",
			body: { name: "prepared-token" },
		},
	};
}

describe("owned BFF completion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.handoff.mockResolvedValue(null);
		mocks.session.mockResolvedValue(null);
		mocks.binding.mockResolvedValue(null);
		mocks.create.mockResolvedValue(sessionId);
		mocks.finish.mockResolvedValue(undefined);
		mocks.cleanup.mockResolvedValue(true);
		mocks.set.mockResolvedValue("OK");
		mocks.acquire.mockResolvedValue(claimed({ purpose: "login" }));
	});
	it("installs a new opaque session without returning Hubuum credentials", async () => {
		const pair = sessionCredentials();
		mocks.fetch
			.mockResolvedValueOnce(Response.json(pair))
			.mockResolvedValueOnce(
				Response.json({
					principal: { identity_scope: "employees", name: "Example" },
				}),
			);
		const response = await completeBrowserInteraction(request());
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/objects");
		expect(mocks.create).toHaveBeenCalledWith(pair, "employees/Example", {
			origin: "https://auth.example",
			revision: "accepted",
		});
		expect(mocks.cookie.mock.calls[0][1]).toBe(sessionId);
		expect(mocks.finish).toHaveBeenCalledWith(sessionId, {
			authenticated: true,
		});
		expect(
			JSON.stringify([...response.headers]) + (await response.text()),
		).not.toContain(pair.access_token);
		expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
			headers: { Authorization: `Hubuum-Interaction ${proof}` },
		});
		expect(mocks.fetch.mock.calls[0][1]).not.toHaveProperty("token");
	});
	it("redelivers the accepted cookie without repeating backend completion", async () => {
		mocks.handoff.mockResolvedValue({ sid: sessionId, returnPath: "/objects" });
		mocks.session.mockResolvedValue({
			sid: sessionId,
			refreshExpiresAt: Date.now() + 300_000,
			absoluteExpiresAt: Date.now() + 600_000,
		});
		const response = await completeBrowserInteraction(request());
		expect(response.status).toBe(303);
		expect(mocks.cookie.mock.calls[0][1]).toBe(sessionId);
		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(mocks.acquire).not.toHaveBeenCalled();
	});
	it("cleans up only the interaction's family after a lost completion response", async () => {
		mocks.fetch.mockRejectedValueOnce(new Error("private-network-detail"));
		const response = await completeBrowserInteraction(request());
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("private-network-detail");
		expect(mocks.fetch).toHaveBeenCalledOnce();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.cleanup).toHaveBeenCalledWith(
			{ origin: "https://auth.example", revision: "accepted" },
			expect.objectContaining({ id }),
			expect.any(String),
		);
	});
	it("revokes the issued family when durable frontend persistence fails", async () => {
		mocks.fetch
			.mockResolvedValueOnce(Response.json(sessionCredentials()))
			.mockResolvedValueOnce(
				Response.json({
					principal: { identity_scope: "employees", name: "Example" },
				}),
			);
		mocks.create.mockRejectedValueOnce(
			new Error("redis://private-credential@storage"),
		);
		const response = await completeBrowserInteraction(request());
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("private-credential");
		expect(mocks.cleanup).toHaveBeenCalledOnce();
		expect(mocks.cookie).not.toHaveBeenCalled();
	});
	it("submits the exact approved operation once with the original bearer and expiry precision", async () => {
		mocks.acquire.mockResolvedValue(claimed(freshIntent()));
		mocks.binding.mockResolvedValue({
			sessionId,
			token: "newer-session-credential",
		});
		mocks.fetch
			.mockResolvedValueOnce(
				Response.json({
					approval,
					record: { id: 7 },
					token_expires_at: expires,
				}),
			)
			.mockResolvedValueOnce(
				Response.json(
					{ id: 9, token: "explicit-one-time-PAT" },
					{ status: 201 },
				),
			);
		const response = await completeBrowserInteraction(request());
		expect(response.status).toBe(303);
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
		const submitted = mocks.fetch.mock.calls[1][1];
		expect(submitted.token).toBe("original-actor-credential");
		expect(mocks.session).not.toHaveBeenCalled();
		expect(submitted.headers.get("X-Hubuum-Credential-Approval")).toBe(
			approval,
		);
		expect(JSON.parse(submitted.body)).toEqual({
			name: "prepared-token",
			expires_at: expires,
		});
		expect(mocks.finish).toHaveBeenCalledWith(browserId, {
			status: 201,
			body: { id: 9, token: "explicit-one-time-PAT" },
		});
		expect(response.headers.get("location")).not.toContain(approval);
	});
	it("records an ambiguous protected result without replaying the mutation", async () => {
		mocks.acquire.mockResolvedValue(claimed(freshIntent()));
		mocks.binding.mockResolvedValue({ sessionId });
		mocks.fetch
			.mockResolvedValueOnce(
				Response.json({
					approval,
					record: { id: 7 },
					token_expires_at: expires,
				}),
			)
			.mockRejectedValueOnce(new Error("response interrupted"));
		const response = await completeBrowserInteraction(request());
		expect(response.status).toBe(303);
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
		expect(mocks.finish).toHaveBeenCalledWith(
			browserId,
			expect.objectContaining({
				status: 502,
				body: expect.objectContaining({ reason: "operation_outcome_unknown" }),
			}),
		);
	});
	it("stores a candidate receipt privately and exposes only its safe preview", async () => {
		mocks.acquire.mockResolvedValue(
			claimed({
				purpose: "provider_verification",
				actor: {
					sid: browserId,
					sessionId,
					token: "original-actor-credential",
				},
				candidateId: id,
			}),
		);
		mocks.binding.mockResolvedValue({ sessionId });
		const receipt = `hcv1.${"c".repeat(64)}`;
		mocks.fetch.mockResolvedValueOnce(
			Response.json({
				candidate: {
					id,
					group: "authentication",
					base_revision: 3,
					expires_at: new Date(Date.now() + 300_000).toISOString(),
					state: "verified",
					verification_receipt: receipt,
					providers: [{ provider_id: id, name: "employees", kind: "oidc" }],
					checks: [],
				},
				verification: {
					candidate_id: id,
					provider_id: id,
					subject: "fixture-subject",
					admitted: true,
					groups: [],
					membership: "none",
					issued_session: false,
					provisioned: false,
				},
			}),
		);
		const response = await completeBrowserInteraction(request());
		expect(response.status).toBe(303);
		expect(mocks.set.mock.calls[0][1]).toContain(receipt);
		expect(JSON.stringify(mocks.finish.mock.calls)).not.toContain(receipt);
	});
});
