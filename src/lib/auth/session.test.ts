import { NextRequest, NextResponse } from "next/server";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const valkeyMock = vi.hoisted(() => {
	const state = new Map<string, string>();
	const control = { deleteAfterGet: false };
	const get = vi.fn(async (key: string) => {
		const value = state.get(key) ?? null;
		if (control.deleteAfterGet) {
			control.deleteAfterGet = false;
			state.delete(key);
		}
		return value;
	});
	const set = vi.fn(
		async (key: string, value: string, ...options: Array<string | number>) => {
			if (options.includes("XX") && !state.has(key)) {
				return null;
			}
			state.set(key, value);
			return "OK";
		},
	);
	const del = vi.fn(async (key: string) => (state.delete(key) ? 1 : 0));

	return { control, del, get, set, state };
});

vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({
		del: valkeyMock.del,
		get: valkeyMock.get,
		set: valkeyMock.set,
	}),
}));

describe("server-side sessions", () => {
	beforeAll(() => {
		vi.stubEnv("BACKEND_BASE_URL", "http://hubuum.test");
		vi.stubEnv("NODE_ENV", "test");
		vi.stubEnv("VALKEY_URL", "redis://valkey.test:6379/0");
	});

	beforeEach(() => {
		valkeyMock.state.clear();
		valkeyMock.control.deleteAfterGet = false;
		vi.clearAllMocks();
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

	it("coalesces parallel hydration and avoids refreshing a recent session", async () => {
		const { SESSION_COOKIE_NAME, createSession, getSessionFromRequest } =
			await import("@/lib/auth/session");
		const sid = await createSession("opaque-backend-token", "local/admin");
		const request = new NextRequest(
			"http://localhost/_hubuum-bff/auth/session",
			{ headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` } },
		);

		const [first, second] = await Promise.all([
			getSessionFromRequest(request),
			getSessionFromRequest(request),
		]);

		expect(first).toEqual(second);
		expect(valkeyMock.get).toHaveBeenCalledTimes(1);
		expect(valkeyMock.set).toHaveBeenCalledTimes(1);

		await getSessionFromRequest(request);
		expect(valkeyMock.get).toHaveBeenCalledTimes(2);
		expect(valkeyMock.set).toHaveBeenCalledTimes(1);
	});

	it("does not recreate a session deleted while a refresh is in flight", async () => {
		const { SESSION_COOKIE_NAME, createSession, getSessionFromRequest } =
			await import("@/lib/auth/session");
		const sid = await createSession("opaque-backend-token", "local/admin");
		const [sessionKey, rawPayload] = [...valkeyMock.state.entries()][0] ?? [];
		expect(sessionKey).toBeDefined();
		expect(rawPayload).toBeDefined();
		if (!sessionKey || !rawPayload) {
			throw new Error("Expected a stored session payload.");
		}
		const payload = JSON.parse(rawPayload) as Record<string, unknown>;
		valkeyMock.state.set(
			sessionKey,
			JSON.stringify({ ...payload, lastSeen: 0 }),
		);
		valkeyMock.control.deleteAfterGet = true;
		const request = new NextRequest(
			"http://localhost/_hubuum-bff/auth/session",
			{ headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` } },
		);

		expect(await getSessionFromRequest(request)).toBeNull();
		expect(valkeyMock.state.has(sessionKey)).toBe(false);
		expect(valkeyMock.set).toHaveBeenCalledTimes(2);
		expect(valkeyMock.set.mock.calls[1]).toContain("XX");
	});
});
