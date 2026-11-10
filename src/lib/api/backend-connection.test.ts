import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendFetchRaw } from "@/lib/api/backend";
import { getBackendTarget, sessionCredential } from "@/lib/backend-target";

const state = vi.hoisted(() => ({
	stored: JSON.stringify({ origin: "https://first.test", revision: "first" }),
	env: {
		BACKEND_BASE_URL: undefined as string | undefined,
		SETTINGS_PREFIX: "test:",
	},
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => state.env }));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({ get: async () => state.stored }),
}));
vi.mock("@/lib/operational-events", () => ({
	emitOperationalEvent: vi.fn(),
	operationalLevelForStatus: () => "info",
	operationalErrorFields: () => ({}),
	sanitizeOperationalPath: (path: string) => path,
}));
const fetchMock = vi.fn();

describe("credentials bound to a server connection", () => {
	beforeEach(() => {
		state.stored = JSON.stringify({
			origin: "https://first.test",
			revision: "first",
		});
		state.env.BACKEND_BASE_URL = undefined;
		fetchMock.mockReset().mockResolvedValue(Response.json({}));
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());
	const credential = () =>
		sessionCredential({
			token: "first-token",
			backendOrigin: "https://first.test",
			backendRevision: "first",
		});
	it("sends the credential only to its checked origin and rejects redirects", async () => {
		await backendFetchRaw("/api/v1/iam/me", { token: credential() });
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe("https://first.test/api/v1/iam/me");
		expect(options.headers.get("Authorization")).toBe("Bearer first-token");
		expect(options.redirect).toBe("error");
	});
	it.each([
		{ origin: "https://second.test", revision: "second" },
		{ origin: "https://first.test", revision: "returned-to-first" },
	])(
		"rejects stale credentials before fetching after changing to $revision",
		async (next) => {
			state.stored = JSON.stringify(next);
			await expect(
				backendFetchRaw("/api/v1/iam/me", { token: credential() }),
			).rejects.toThrow("connection changed");
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
	it("also binds passwords and refresh credentials carried in request bodies", async () => {
		const target = await getBackendTarget();
		if (!target) throw new Error("Missing target");
		state.stored = JSON.stringify({
			origin: "https://second.test",
			revision: "second",
		});
		await expect(
			backendFetchRaw("/api/v1/auth/refresh", {
				target,
				method: "POST",
				body: "secret-body",
			}),
		).rejects.toThrow("connection changed");
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("fails closed for unbound tokens on a changeable installation", async () => {
		await expect(
			backendFetchRaw("/api/v1/iam/me", { token: "unbound" }),
		).rejects.toThrow("must be bound");
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("preserves legacy callers on an environment-managed deployment", async () => {
		state.env.BACKEND_BASE_URL = "https://static.test";
		await backendFetchRaw("/api/v1/iam/me", { token: "legacy" });
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://static.test/api/v1/iam/me",
		);
	});
});
