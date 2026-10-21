import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCredentials } from "@/test/session-fixtures";
import { sessionPayload, type SessionPayload } from "./session-credentials";
import { refreshSession } from "./session-refresh";
import type { SessionStore } from "./session-store";

const backend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/backend", () => ({ backendFetchRaw: backend }));

// An atomic store seam exercises independent callers without process-local locks.
function testStore(initial: SessionPayload): SessionStore {
	let value: SessionPayload | null = structuredClone(initial);
	return {
		async create(_sid, payload) {
			value = structuredClone(payload);
		},
		async get() {
			return structuredClone(value);
		},
		async touch() {
			return false;
		},
		async claimRefresh(_sid, generation, owner) {
			if (!value || value.generation !== generation || value.refreshing)
				return false;
			value.refreshing = owner;
			return true;
		},
		async completeRefresh(_sid, generation, owner, payload) {
			if (
				!value ||
				value.generation !== generation ||
				value.refreshing !== owner
			)
				return false;
			value = structuredClone(payload);
			return true;
		},
		async invalidateGeneration(_sid, generation) {
			if (value?.generation === generation) value = null;
		},
		async destroy() {
			value = null;
		},
	};
}

function rotationFixture() {
	const pair = sessionCredentials();
	const initial = { ...sessionPayload(pair), refreshAt: 0 };
	const next = sessionCredentials({
		...pair,
		access_token: "next-access",
		refresh_token: "next-refresh",
	});
	return { initial, next, store: testStore(initial) };
}

describe("distributed session refresh", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("coalesces independent callers into one rotation", async () => {
		const { initial, next, store } = rotationFixture();
		backend.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return Response.json(next);
		});
		const results = await Promise.all(
			Array.from({ length: 20 }, () => refreshSession(store, "sid", initial)),
		);
		expect(backend).toHaveBeenCalledTimes(1);
		expect(
			results.every(
				(value) =>
					value?.token === "next-access" &&
					value.refreshToken === "next-refresh",
			),
		).toBe(true);
		expect(backend.mock.calls[0][1].token).toBeUndefined();
	});

	it.each(["transport", "rejected", "invalid", "reused", "family", "absolute"])(
		"requires sign-in after a %s refresh outcome",
		async (failure) => {
			const { initial, next, store } = rotationFixture();
			if (failure === "transport")
				backend.mockRejectedValue(new Error("request secret must not escape"));
			else if (failure === "rejected")
				backend.mockResolvedValue(new Response(null, { status: 401 }));
			else
				backend.mockResolvedValue(
					Response.json(
						failure === "invalid"
							? {}
							: {
									...next,
									...(failure === "reused"
										? { refresh_token: initial.refreshToken }
										: {}),
									...(failure === "family"
										? { session_id: crypto.randomUUID() }
										: {}),
									...(failure === "absolute"
										? {
												absolute_expires_at: new Date(
													initial.absoluteExpiresAt + 1000,
												).toISOString(),
											}
										: {}),
								},
					),
				);
			expect(await refreshSession(store, "sid", initial)).toBeNull();
			expect(await store.get("sid")).toBeNull();
			expect(
				backend.mock.calls.filter(([path]) => path === "/api/v1/auth/refresh"),
			).toHaveLength(1);
		},
	);

	it("cannot recreate a session deleted during the upstream request", async () => {
		const { initial, next, store } = rotationFixture();
		backend.mockImplementation(async (path) => {
			if (path.endsWith("refresh")) await store.destroy("sid");
			return Response.json(next);
		});
		expect(await refreshSession(store, "sid", initial)).toBeNull();
		expect(await store.get("sid")).toBeNull();
		expect(backend).toHaveBeenLastCalledWith(
			"/api/v1/auth/logout",
			expect.objectContaining({ token: "next-access" }),
		);
	});

	it("never retries a refresh claim left by a failed instance", async () => {
		vi.useFakeTimers();
		try {
			const { initial, store } = rotationFixture();
			await store.claimRefresh("sid", initial.generation, crypto.randomUUID());
			const pending = refreshSession(store, "sid", initial);
			await vi.advanceTimersByTimeAsync(10_001);
			expect(await pending).toBeNull();
			expect(backend).not.toHaveBeenCalled();
			expect(await store.get("sid")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
