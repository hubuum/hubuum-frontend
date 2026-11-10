import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/%5Fhubuum-bff/setup/route";
import { getBackendBaseUrl, getBackendSetupStatus } from "@/lib/backend-target";

const state = vi.hoisted(() => ({
	env: {
		BACKEND_BASE_URL: undefined as string | undefined,
		SETUP_KEY: "test-only-setup-key-with-32-characters",
		SETTINGS_PREFIX: "test:settings:",
	},
	values: new Map<string, string>(),
	get: vi.fn(),
	set: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => state.env }));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({ get: state.get, set: state.set }),
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
) {
	return new NextRequest("https://console.test/_hubuum-bff/setup", {
		method: "POST",
		headers: {
			origin: "https://console.test",
			"content-type": "application/json",
			"x-hubuum-setup-key": state.env.SETUP_KEY,
			"x-correlation-id": "setup-test",
			...headers,
		},
		body: JSON.stringify({ action, url }),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	state.env.BACKEND_BASE_URL = undefined;
	state.env.SETUP_KEY = "test-only-setup-key-with-32-characters";
	state.values.clear();
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
afterEach(() => vi.unstubAllGlobals());

describe("one-time installation setup", () => {
	it("checks without saving, then rechecks and saves a shared origin without expiry", async () => {
		expect(await getBackendSetupStatus()).toBe("available");
		const checked = await POST(request());
		expect(checked.status).toBe(200);
		expect(await checked.json()).toEqual({
			origin: "https://hubuum.test",
			version: "0.0.22",
			saved: false,
		});
		expect(state.set).not.toHaveBeenCalled();
		const saved = await POST(request("save"));
		expect(saved.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(6);
		expect(state.set).toHaveBeenCalledWith(
			installationKey,
			"https://hubuum.test",
			"NX",
		);
		expect(await getBackendBaseUrl()).toBe("https://hubuum.test");
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
			expect(state.get).not.toHaveBeenCalled();
		},
	);
	it("requires same-origin mutation metadata", async () => {
		expect(
			(await POST(request("save", undefined, { origin: "https://other.test" })))
				.status,
		).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("disables setup without an operator key", async () => {
		state.env.SETUP_KEY = "";
		expect(await getBackendSetupStatus()).toBe("disabled");
		expect((await POST(request())).status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
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
			Response.json({
				...document,
				info: { ...document.info, version: "0.0.23" },
			}),
		],
		[
			"/api-doc/openapi.json",
			new Response("<html>Login</html>", {
				headers: { "content-type": "text/html" },
			}),
		],
		["/api/v1/config", Response.json({})],
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
