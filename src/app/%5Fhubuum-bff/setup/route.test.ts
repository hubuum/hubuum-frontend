import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/%5Fhubuum-bff/setup/route";
import {
	changeBackend,
	getBackendBaseUrl,
	getBackendSetupStatus,
	getBackendTarget,
	getSetupKey,
	initializeSetupKey,
} from "@/lib/backend-target";
import { type BackendCheck } from "@/lib/backend-setup";

const state = vi.hoisted(() => ({
	env: {
		BACKEND_BASE_URL: undefined as string | undefined,
		SETUP_KEY: "test-only-setup-key-with-32-characters" as string | undefined,
		SETTINGS_PREFIX: "test:settings:",
	},
	values: new Map<string, string>(),
	get: vi.fn(),
	set: vi.fn(),
	del: vi.fn(),
	eval: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => state.env }));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({
		get: state.get,
		set: state.set,
		del: state.del,
		eval: state.eval,
	}),
}));

const document = {
	openapi: "3.1.0",
	info: { title: "Hubuum REST API", version: "0.0.22" },
	paths: {
		"/api/v1/auth/login": { post: {} },
		"/api/v1/auth/refresh": { post: {} },
		"/api/v1/iam/me": { get: {} },
		"/api/v1/config": { get: {} },
	},
};
const config = {
	authentication: {
		session_access_seconds: 300,
		session_idle_seconds: 3600,
		session_absolute_seconds: 28800,
	},
	pagination: { default_page_limit: 50, max_page_limit: 250 },
};
const fetchMock = vi.fn();
const installationKey = "test:settings:installation:backend";

function request(
	action = "check",
	url = "https://hubuum.test/",
	headers: Record<string, string> = {},
	confirmation?: BackendCheck,
) {
	return new NextRequest("https://console.test/_hubuum-bff/setup", {
		method: "POST",
		headers: {
			origin: "https://console.test",
			"content-type": "application/json",
			"x-hubuum-setup-key": state.env.SETUP_KEY ?? "",
			"x-correlation-id": "setup-test",
			...headers,
		},
		body: JSON.stringify({ action, url, confirmation }),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	state.env.BACKEND_BASE_URL = undefined;
	state.env.SETUP_KEY = "test-only-setup-key-with-32-characters";
	state.values.clear();
	state.del.mockImplementation(async (key: string) =>
		Number(state.values.delete(key)),
	);
	state.eval.mockImplementation(
		async (_script: string, count: number, key: string, ...args: string[]) => {
			if (count === 2) {
				if (_script.includes("redis.call('DEL'")) {
					if (state.values.has(key)) return 0;
					await state.set(key, args[1], "NX");
					state.values.delete(args[0]);
					return 1;
				}
				if (state.values.has(key)) return [];
				if (state.values.has(args[0])) return [state.values.get(args[0]), 0];
				state.values.set(args[0], args[1]);
				return [args[1], 1];
			}
			if (state.values.get(key) !== args[0]) return 0;
			state.values.set(key, args[1]);
			return 1;
		},
	);
	state.get.mockImplementation(
		async (key: string) => state.values.get(key) ?? null,
	);
	state.set.mockImplementation(async (key: string, value: string) => {
		if (state.values.has(key)) return null;
		state.values.set(key, value);
		return "OK";
	});
	fetchMock.mockImplementation(async (url: URL) => {
		if (url.pathname === "/readyz") return new Response(null, { status: 200 });
		return Response.json(
			url.pathname === "/api-doc/openapi.json" ? document : config,
		);
	});
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("one-time installation setup", () => {
	it("checks without saving, then rechecks and saves a shared origin without expiry", async () => {
		expect(await getBackendSetupStatus()).toBe("available");
		const checked = await POST(request());
		expect(checked.status).toBe(200);
		expect(await checked.json()).toEqual({
			origin: "https://hubuum.test",
			version: "0.0.22",
			compatibility: "supported",
			warnings: [],
			saved: false,
		});
		expect(state.set).not.toHaveBeenCalled();
		const saved = await POST(request("save"));
		expect(saved.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(6);
		expect(state.set).toHaveBeenCalledWith(
			installationKey,
			expect.any(String),
			"NX",
		);
		expect(await getBackendBaseUrl()).toBe("https://hubuum.test");
		expect((await getBackendTarget())?.revision).toMatch(/^[0-9a-f-]{36}$/);
		expect(await getBackendSetupStatus()).toBe("configured");
		expect(saved.headers.get("cache-control")).toBe("no-store");
	});
	it("does not forward the setup key, browser cookies, or credentials to discovery", async () => {
		await POST(
			request("check", "http://hubuum:8080", {
				cookie: "hubuum.sid=browser-cookie",
			}),
		);
		for (const [url, options] of fetchMock.mock.calls) {
			expect(url.origin).toBe("http://hubuum:8080");
			expect(options).toMatchObject({ redirect: "error", cache: "no-store" });
			expect(options.headers).toEqual({
				Accept: "application/json",
				"x-correlation-id": "setup-test",
			});
		}
	});
	it.each(["", "wrong-key"])(
		"rejects incorrect keys before contacting any backend",
		async (key) => {
			expect(
				(await POST(request("check", undefined, { "x-hubuum-setup-key": key })))
					.status,
			).toBe(403);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(state.set).not.toHaveBeenCalled();
		},
	);
	it("requires same-origin mutation metadata", async () => {
		expect(
			(await POST(request("save", undefined, { origin: "https://other.test" })))
				.status,
		).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("generates one shared bootstrap key and consumes it on setup", async () => {
		state.env.SETUP_KEY = undefined;
		const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		await Promise.all([initializeSetupKey(), initializeSetupKey()]);
		const key = await getSetupKey();
		expect(typeof key === "string" && /^[a-f0-9]{64}$/.test(key)).toBe(true);
		expect(output).toHaveBeenCalledTimes(1);
		expect(await getBackendSetupStatus()).toBe("available");
		await initializeSetupKey(true);
		expect((await getSetupKey()) === key).toBe(true);
		expect(output).toHaveBeenCalledTimes(2);
		expect(
			(
				await POST(
					request("save", undefined, { "x-hubuum-setup-key": key ?? "" }),
				)
			).status,
		).toBe(200);
		expect(await getSetupKey()).toBeNull();
		await initializeSetupKey(true);
		expect(output).toHaveBeenCalledTimes(2);
		expect((await POST(request())).status).toBe(409);
	});
	it("never prints an operator-supplied key", async () => {
		const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		await initializeSetupKey(true);
		expect(output).not.toHaveBeenCalled();
	});
	it("changes the saved target atomically and gives a returning origin a fresh revision", async () => {
		await POST(request("save"));
		const first = await getBackendTarget();
		if (!first) throw new Error("Expected a target");
		expect(await changeBackend(first, "https://second.test")).toBe(true);
		expect(await changeBackend(first, "https://stale.test")).toBe(false);
		const second = await getBackendTarget();
		if (!second) throw new Error("Expected a target");
		expect(await changeBackend(second, first.origin)).toBe(true);
		expect((await getBackendTarget())?.revision).not.toBe(first.revision);
	});
	it("uses an environment target without depending on the installation store", async () => {
		state.env.BACKEND_BASE_URL = "https://configured.test";
		state.values.set(installationKey, "https://saved.test");
		expect(await getBackendBaseUrl()).toBe("https://configured.test");
		expect((await POST(request("save"))).status).toBe(409);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(state.get).not.toHaveBeenCalled();
	});
	it("prevents replacement after setup", async () => {
		state.values.set(installationKey, "https://saved.test");
		expect((await POST(request("save"))).status).toBe(409);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("allows only one concurrent setup to win", async () => {
		const results = await Promise.all([
			POST(request("save")),
			POST(request("save", "https://other.test")),
		]);
		expect(results.map((response) => response.status).sort()).toEqual([
			200, 409,
		]);
		expect(state.values.size).toBe(1);
	});
	it("rejects paths and embedded credentials before probing", async () => {
		expect(
			(await POST(request("check", "https://secret:password@hubuum/api/v1")))
				.status,
		).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("reports unreachable servers without exposing network errors", async () => {
		fetchMock.mockRejectedValue(new Error("sensitive network details"));
		const response = await POST(request("save"));
		expect(response.status).toBe(422);
		expect(await response.text()).not.toContain("sensitive");
		expect(state.set).not.toHaveBeenCalled();
	});
	it.each([
		["/readyz", new Response(null, { status: 503 })],
		[
			"/api-doc/openapi.json",
			new Response("<html>Login</html>", {
				headers: { "content-type": "text/html" },
			}),
		],
	])("does not save failed discovery at %s", async (path, response) => {
		fetchMock.mockImplementation(async (url: URL) =>
			url.pathname === path
				? response
				: Response.json(
						url.pathname === "/api-doc/openapi.json" ? document : config,
					),
		);
		expect((await POST(request("save"))).status).toBe(422);
		expect(state.set).not.toHaveBeenCalled();
	});
	it.each(["0.0.21", "0.0.19-patched", "main"])(
		"requires explicit confirmation before saving %s",
		async (version) => {
			fetchMock.mockImplementation(async (url: URL) =>
				Response.json(
					url.pathname === "/api-doc/openapi.json"
						? { ...document, info: { ...document.info, version } }
						: config,
				),
			);
			const checked = await POST(request());
			expect(checked.status).toBe(200);
			const check: BackendCheck = await checked.json();
			expect(check.compatibility).not.toBe("supported");
			expect((await POST(request("save"))).status).toBe(409);
			expect(state.set).not.toHaveBeenCalled();
			expect((await POST(request("save", undefined, {}, check))).status).toBe(
				200,
			);
			expect(await getBackendBaseUrl()).toBe("https://hubuum.test");
		},
	);
	it("requires fresh confirmation if the version or warnings change during save", async () => {
		let version = "0.0.21";
		fetchMock.mockImplementation(async (url: URL) =>
			Response.json(
				url.pathname === "/api-doc/openapi.json"
					? { ...document, info: { ...document.info, version } }
					: config,
			),
		);
		const check: BackendCheck = await (await POST(request())).json();
		version = "0.0.19";
		const changed = await POST(request("save", undefined, {}, check));
		expect(changed.status).toBe(409);
		expect(await changed.json()).toMatchObject({
			version,
			compatibility: "incompatible",
			saved: false,
		});
		expect(state.set).not.toHaveBeenCalled();
	});
	it("ties confirmation to the checked origin", async () => {
		fetchMock.mockImplementation(async (url: URL) =>
			Response.json(
				url.pathname === "/api-doc/openapi.json"
					? { ...document, paths: {} }
					: config,
			),
		);
		const check: BackendCheck = await (await POST(request())).json();
		expect(
			(await POST(request("save", "https://other.test", {}, check))).status,
		).toBe(409);
		expect(state.set).not.toHaveBeenCalled();
	});
	it.each([404, 503])(
		"allows explicit override when public configuration returns %s",
		async (status) => {
			fetchMock.mockImplementation(async (url: URL) =>
				url.pathname === "/api/v1/config"
					? new Response(null, { status })
					: Response.json(document),
			);
			const check: BackendCheck = await (await POST(request())).json();
			expect(check).toMatchObject({
				compatibility: "unverified",
				warnings: [expect.stringContaining("public configuration")],
			});
			expect((await POST(request("save"))).status).toBe(409);
			expect((await POST(request("save", undefined, {}, check))).status).toBe(
				200,
			);
		},
	);
	it("fails closed when Valkey cannot save the choice", async () => {
		state.set.mockRejectedValue(new Error("redis://user:secret@valkey"));
		const response = await POST(request("save"));
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("secret");
	});
	it("reports store failure separately from an unconfigured installation", async () => {
		state.get.mockRejectedValue(new Error("unavailable"));
		expect(await getBackendSetupStatus()).toBe("unavailable");
		expect((await POST(request())).status).toBe(503);
	});
});
