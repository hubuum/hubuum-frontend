import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(),
	getSessionFromRequest: vi.fn(),
	validateBackendSession: vi.fn(),
	destroySession: vi.fn(),
	clearSessionCookie: vi.fn(),
}));
vi.mock("@/lib/api/backend", () => ({
	backendFetchRaw: mocks.backendFetchRaw,
}));
vi.mock("@/lib/auth/session", () => mocks);
vi.mock("@/lib/auth/backend-session-validation", () => mocks);

import { POST } from "@/app/%5Fhubuum-bff/credential-mutations/route";

const secret = `hca1.${"a".repeat(64)}`;
const expiry = "2026-09-20T12:34:56.123456";
const correlationId = "78a802c3-5427-4a0e-a64a-90189f393393";
function approval(extra = {}) {
	return Response.json(
		{
			approval: secret,
			record: { id: 23 },
			token_expires_at: expiry,
			...extra,
		},
		{ status: 201 },
	);
}
function request(overrides = {}, origin = "https://console.example") {
	return new NextRequest(
		"https://console.example/_hubuum-bff/credential-mutations",
		{
			method: "POST",
			headers: {
				Origin: origin,
				"Content-Type": "application/json",
				"X-Correlation-Id": correlationId,
			},
			body: JSON.stringify({
				password: "actor-password",
				method: "POST",
				path: "/api/v1/iam/principals/42/tokens",
				body: { name: "reader", scope: { permissions: ["ReadObject"] } },
				...overrides,
			}),
		},
	);
}

describe("credential mutation BFF", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getSessionFromRequest.mockResolvedValue({
			sid: "session",
			token: "original-bearer",
		});
		mocks.validateBackendSession.mockResolvedValue("valid");
		mocks.backendFetchRaw
			.mockResolvedValueOnce(approval())
			.mockResolvedValueOnce(
				Response.json(
					{ token: "issued-token", expires_at: expiry },
					{ status: 201 },
				),
			);
	});

	it.each([null, "2026-09-20T12:34:56.123456789"])(
		"uses the exact approved expiry for requested %s and keeps approval server-side",
		async (expires_at) => {
			const body = {
				name: "reader",
				expires_at,
				scope: { permissions: ["ReadObject"], resources: { collections: [7] } },
			};
			const response = await POST(request({ body }));
			expect(response.status).toBe(201);
			expect(await response.json()).toEqual({
				token: "issued-token",
				expires_at: expiry,
			});
			const [approvalPath, approvalInit] = mocks.backendFetchRaw.mock.calls[0];
			expect(approvalPath).toBe("/api/v1/iam/credential-approvals");
			expect(JSON.parse(approvalInit.body)).toEqual({
				password: "actor-password",
				operation: { kind: "create_token", principal_id: 42, token: body },
			});
			const [path, init] = mocks.backendFetchRaw.mock.calls[1];
			expect(path).toBe("/api/v1/iam/principals/42/tokens");
			expect(JSON.parse(init.body)).toEqual({ ...body, expires_at: expiry });
			expect(init.token).toBe(approvalInit.token);
			expect(init.token).toBe("original-bearer");
			expect(init.correlationId).toBe(correlationId);
			expect(init.headers.get("x-hubuum-credential-approval")).toBe(secret);
			expect(response.headers.get("x-hubuum-credential-approval")).toBeNull();
			expect(response.headers.get("cache-control")).toBe("private, no-store");
		},
	);

	it.each([
		[
			"POST",
			"/api/v1/iam/principals/42/tokens/99/renew",
			{ expires_at: null },
			{ kind: "renew_token", principal_id: 42, token_id: 99 },
			"token",
		],
		[
			"POST",
			"/api/v1/iam/users",
			{ name: "new-user", password: "new-password" },
			{ kind: "create_user" },
			"user",
		],
		[
			"PATCH",
			"/api/v1/iam/users/42",
			{ password: "changed-password", proper_name: "Name" },
			{ kind: "update_user", user_id: 42 },
			"user",
		],
		[
			"POST",
			"/api/v1/imports",
			{
				version: 1,
				dry_run: true,
				graph: {
					principals: [
						{ name: "one", password: "new-password" },
						{ name: "two", password_hash: "hash" },
					],
				},
			},
			{ kind: "import_credentials" },
			"import",
		],
		[
			"POST",
			"/api/v1/restores/42/confirm",
			{
				restore_capability: "capability",
				sha256: "digest",
				confirmation: "REPLACE ALL HUBUUM DATA",
			},
			{ kind: "confirm_restore", restore_id: 42 },
			"confirmation",
		],
	])(
		"binds %s %s to its complete payload and preserves mutation headers",
		async (method, path, body, operation, field) => {
			const response = await POST(
				request({
					method,
					path,
					body,
					ifMatch: '"revision:7"',
					idempotencyKey: "import-key",
				}),
			);
			expect(response.status).toBe(201);
			expect(
				JSON.parse(mocks.backendFetchRaw.mock.calls[0][1].body).operation,
			).toEqual({ ...operation, [field]: body });
			const [actualPath, init] = mocks.backendFetchRaw.mock.calls[1];
			expect(actualPath).toBe(path);
			expect(init.method).toBe(method);
			expect(JSON.parse(init.body)).toEqual(
				operation.kind === "renew_token"
					? { ...body, expires_at: expiry }
					: body,
			);
			expect(init.headers.get("if-match")).toBe('"revision:7"');
			expect(init.headers.get("idempotency-key")).toBe("import-key");
		},
	);

	it("rejects cross-origin confirmation before accessing sessions", async () => {
		expect((await POST(request({}, "https://other.example"))).status).toBe(403);
		expect(mocks.getSessionFromRequest).not.toHaveBeenCalled();
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
	});
	it("requires a browser session", async () => {
		mocks.getSessionFromRequest.mockResolvedValue(null);
		expect((await POST(request())).status).toBe(401);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
	});
	it.each([
		"https://other.example/api/v1/iam/users",
		"/api/v0/meta/db",
		"/api/v1/iam/users?target=1",
		"/api/v1/iam/credential-approvals",
		"/api/v1/iam/users/../users",
	])("rejects unapproved path %s", async (path) => {
		expect((await POST(request({ path }))).status).toBe(400);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
	});
	it("rejects credential imports without a retry key", async () => {
		expect(
			(
				await POST(
					request({ path: "/api/v1/imports", body: { version: 1, graph: {} } }),
				)
			).status,
		).toBe(400);
		expect(mocks.backendFetchRaw).not.toHaveBeenCalled();
	});
	it("keeps a valid session after an incorrect password and performs no mutation", async () => {
		mocks.backendFetchRaw
			.mockReset()
			.mockResolvedValue(
				Response.json({ message: "Unauthorized" }, { status: 401 }),
			);
		const response = await POST(request());
		expect(response.status).toBe(403);
		expect((await response.json()).reason).toBe("password_confirmation_failed");
		expect(mocks.destroySession).not.toHaveBeenCalled();
		expect(mocks.backendFetchRaw).toHaveBeenCalledOnce();
	});
	it("expires a revoked session after approval authentication fails", async () => {
		mocks.backendFetchRaw
			.mockReset()
			.mockResolvedValue(new Response(null, { status: 401 }));
		mocks.validateBackendSession.mockResolvedValue("expired");
		expect((await POST(request())).status).toBe(401);
		expect(mocks.destroySession).toHaveBeenCalledWith("session");
		expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
	});
	it.each([403, 404, 429, 503])(
		"does not fall back to an unapproved mutation on approval status %s",
		async (status) => {
			mocks.backendFetchRaw
				.mockReset()
				.mockResolvedValue(
					Response.json(
						{ message: "Unavailable" },
						{ status, headers: { "Retry-After": "30" } },
					),
				);
			const response = await POST(request());
			expect(response.status).toBe(status);
			expect(response.headers.get("retry-after")).toBe("30");
			expect(mocks.backendFetchRaw).toHaveBeenCalledOnce();
		},
	);
	it.each([{ approval: "bad" }, { token_expires_at: null }, { record: null }])(
		"fails closed for malformed approval %j",
		async (extra) => {
			mocks.backendFetchRaw.mockReset().mockResolvedValue(approval(extra));
			expect((await POST(request())).status).toBe(502);
			expect(mocks.backendFetchRaw).toHaveBeenCalledOnce();
		},
	);
	it("does not retry a lost mutation response or expose the approval", async () => {
		mocks.backendFetchRaw
			.mockReset()
			.mockResolvedValueOnce(approval())
			.mockRejectedValueOnce(new Error(`untrusted ${secret}`));
		const response = await POST(request());
		const text = await response.text();
		expect(response.status).toBe(502);
		expect(text).toContain("approval #23");
		expect(text).toContain("may have completed");
		expect(text).not.toContain(secret);
		expect(mocks.backendFetchRaw).toHaveBeenCalledTimes(2);
	});
	it("keeps concurrent approvals bound to their own operations", async () => {
		mocks.backendFetchRaw.mockReset().mockImplementation(async (path, init) => {
			const body = JSON.parse(init.body);
			if (path.endsWith("credential-approvals"))
				return approval({
					approval: `hca1.${String(body.operation.principal_id).repeat(64)}`,
				});
			const id = path.includes("/1/") ? "1" : "2";
			expect(init.headers.get("x-hubuum-credential-approval")).toBe(
				`hca1.${id.repeat(64)}`,
			);
			return Response.json({ id }, { status: 201 });
		});
		const responses = await Promise.all(
			[1, 2].map((id) =>
				POST(request({ path: `/api/v1/iam/principals/${id}/tokens` })),
			),
		);
		expect(responses.map((response) => response.status)).toEqual([201, 201]);
	});
});
