import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const valkeyState = vi.hoisted(() => new Map<string, string>());

vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({
		del: vi.fn(async (key: string) => (valkeyState.delete(key) ? 1 : 0)),
		get: vi.fn(async (key: string) => valkeyState.get(key) ?? null),
		set: vi.fn(async (key: string, value: string) => {
			valkeyState.set(key, value);
			return "OK";
		}),
	}),
}));

describe("server-side sessions", () => {
	beforeAll(() => {
		vi.stubEnv("BACKEND_BASE_URL", "http://hubuum.test");
		vi.stubEnv("NODE_ENV", "test");
		vi.stubEnv("VALKEY_URL", "redis://valkey.test:6379/0");
	});

	afterAll(() => {
		vi.unstubAllEnvs();
	});

	it("keeps backend tokens in the mocked Valkey store", async () => {
		const {
			SESSION_COOKIE_NAME,
			createSession,
			destroySession,
			getSessionFromRequest,
			setSessionCookie,
		} = await import("@/lib/auth/session");
		const token = "opaque-backend-token";
		const sid = await createSession(token, "local/admin");
		const request = new NextRequest("http://localhost/login");
		const response = NextResponse.json({ authenticated: true });

		setSessionCookie(response, sid, request);

		expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe(sid);
		expect(response.cookies.get("hubuum.token")?.value).toBe("");
		expect(response.headers.get("set-cookie")).not.toContain(token);

		const authenticatedRequest = new NextRequest(
			"http://localhost/_hubuum-bff/auth/session",
			{ headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` } },
		);
		const session = await getSessionFromRequest(authenticatedRequest);

		expect(session).toMatchObject({ sid, token, username: "local/admin" });

		await destroySession(sid);
		expect(await getSessionFromRequest(authenticatedRequest)).toBeNull();
	});
});
