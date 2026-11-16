import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preserveCandidateReport } from "./candidate-verification";
import {
	createSecurityCandidate,
	securityCandidateAction,
} from "./security-candidates";

const mocks = vi.hoisted(() => ({
	fetch: vi.fn(),
	session: vi.fn(),
	admin: vi.fn(),
	values: new Map<string, string>(),
}));
const actor = {
	sid: "private-session",
	token: "fixture-actor-token",
	sessionId: "fixture-family",
};
const target = { origin: "https://auth.example", revision: "one" };
vi.mock("@/lib/api/backend", () => ({ backendFetchRaw: mocks.fetch }));
vi.mock("@/lib/backend-target", () => ({
	getBackendTarget: async () => ({
		origin: "https://auth.example",
		revision: "one",
	}),
	sessionCredential: (session: { token: string }) => session.token,
}));
vi.mock("@/lib/auth/session", () => ({
	getSessionFromRequest: mocks.session,
	SESSION_COOKIE_NAME: "hubuum.sid",
	setSessionCookie: vi.fn(),
}));
vi.mock("@/lib/auth/admin", () => ({
	probeAdminAccess: mocks.admin,
	discardAdminProbeResponse: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
	getServerEnv: () => ({ SESSION_PREFIX: "test:" }),
}));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({
		get: async (key: string) => mocks.values.get(key) ?? null,
		set: async (key: string, value: string) => {
			mocks.values.set(key, value);
			return "OK";
		},
		del: async (key: string) => Number(mocks.values.delete(key)),
	}),
}));
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const receipt = `hcv1.${"a".repeat(64)}`;
const approval = `hca1.${"b".repeat(64)}`;
const path = "/api/v1/admin/runtime-settings/security-candidates";
function report() {
	return {
		id,
		group: "authentication",
		base_revision: 1,
		expires_at: new Date(Date.now() + 300_000).toISOString(),
		state: "verified",
		verification_receipt: receipt,
		providers: [],
		checks: [],
	};
}
function request(body?: unknown, origin = "https://console.example") {
	return new NextRequest(
		"https://console.example/_hubuum-bff/admin/security-candidates",
		{
			method: body === undefined ? "GET" : "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		},
	);
}
describe("administrator candidate BFF boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.values.clear();
		mocks.session.mockResolvedValue(actor);
		mocks.admin.mockResolvedValue({
			status: "allowed",
			response: new Response(null),
		});
	});
	it("rejects cross-origin creation before reading a session or contacting the backend", async () => {
		const response = await createSecurityCandidate(
			request({}, "https://attacker.example"),
		);
		expect(response.status).toBe(403);
		expect(mocks.session).not.toHaveBeenCalled();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
	it.each(["forbidden", "unavailable"])(
		"does not create candidates when the admin probe is %s",
		async (status) => {
			mocks.admin.mockResolvedValue({ status });
			const response = await createSecurityCandidate(
				request({
					group: "authentication",
					expected_revision: 1,
					providers: [],
				}),
			);
			expect(response.status).toBe(status === "forbidden" ? 403 : 503);
			expect(mocks.fetch).not.toHaveBeenCalled();
		},
	);
	it("returns a redacted candidate and stores its receipt only on the server", async () => {
		mocks.fetch.mockResolvedValueOnce(Response.json(report(), { status: 201 }));
		const response = await createSecurityCandidate(
			request({ group: "authentication", expected_revision: 1, providers: [] }),
		);
		expect(response.status).toBe(201);
		expect(await response.text()).not.toContain(receipt);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect([...mocks.values.values()][0]).toContain(receipt);
	});
	it("binds activation to the private receipt and exact server-selected approval operation", async () => {
		await preserveCandidateReport(actor, target, report());
		mocks.fetch
			.mockResolvedValueOnce(Response.json({ approval }))
			.mockResolvedValueOnce(
				Response.json({ group: "authentication", revision: 2, changed: true }),
			);
		const response = await securityCandidateAction(
			request({ expected_revision: 1, password: "fixture-only-password" }),
			id,
			"activate",
		);
		expect(response.status).toBe(200);
		const [approvalPath, approvalOptions] = mocks.fetch.mock.calls[0];
		expect(approvalPath).toBe("/api/v1/iam/credential-approvals");
		expect(JSON.parse(approvalOptions.body)).toEqual({
			password: "fixture-only-password",
			operation: {
				kind: "activate_security_candidate",
				candidate_id: id,
				group: "authentication",
				expected_revision: 1,
			},
		});
		const [activationPath, activationOptions] = mocks.fetch.mock.calls[1];
		expect(activationPath).toBe(`${path}/${id}/activate`);
		expect(JSON.parse(activationOptions.body)).toEqual({
			expected_revision: 1,
			verification_receipt: receipt,
		});
		expect(activationOptions.headers["X-Hubuum-Credential-Approval"]).toBe(
			approval,
		);
		const visible = await response.text();
		expect(visible).not.toContain(receipt);
		expect(visible).not.toContain(approval);
		expect(mocks.values.size).toBe(0);
	});
	it.each(["verification_receipt", "approval", "operation"])(
		"rejects browser-supplied %s during activation",
		async (field) => {
			await preserveCandidateReport(actor, target, report());
			const response = await securityCandidateAction(
				request({
					expected_revision: 1,
					password: "fixture-only",
					[field]: "fixture-authority",
				}),
				id,
				"activate",
			);
			expect(response.status).toBe(400);
			expect(mocks.fetch).not.toHaveBeenCalled();
		},
	);
	it("requires a new candidate after the initiating token rotates", async () => {
		await preserveCandidateReport(actor, target, report());
		mocks.session.mockResolvedValue({ ...actor, token: "rotated-token" });
		const response = await securityCandidateAction(
			request({ expected_revision: 1, password: "fixture-only" }),
			id,
			"activate",
		);
		expect(response.status).toBe(409);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
	it("does not activate when fresh local approval is denied", async () => {
		await preserveCandidateReport(actor, target, report());
		mocks.fetch.mockResolvedValueOnce(
			Response.json({ message: "private-provider-detail" }, { status: 403 }),
		);
		const response = await securityCandidateAction(
			request({ expected_revision: 1, password: "fixture-only" }),
			id,
			"activate",
		);
		expect(response.status).toBe(403);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(await response.text()).not.toContain("private-provider-detail");
	});
});
