import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/%5Fhubuum-bff/connection/route";

const mocks = vi.hoisted(() => ({
	session: vi.fn(),
	admin: vi.fn(),
	target: vi.fn(),
	inspect: vi.fn(),
	change: vi.fn(),
	clear: vi.fn(),
	env: { BACKEND_BASE_URL: undefined as string | undefined },
}));
vi.mock("@/lib/auth/session", () => ({
	getSessionFromRequest: mocks.session,
	clearSessionCookie: mocks.clear,
}));
vi.mock("@/lib/auth/admin", () => ({ hasAdminAccess: mocks.admin }));
vi.mock("@/lib/backend-discovery", () => ({ inspectBackend: mocks.inspect }));
vi.mock("@/lib/backend-target", () => ({
	getBackendTarget: mocks.target,
	changeBackend: mocks.change,
	sessionCredential: (session: unknown) => session,
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => mocks.env }));

const current = { origin: "https://first.test", revision: "first" };
const check = {
	version: "0.0.22",
	compatibility: "supported",
	warnings: [],
	origin: "https://second.test",
};
function request(body: object = {}, origin = "https://console.test") {
	return new NextRequest("https://console.test/_hubuum-bff/connection", {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: JSON.stringify({
			url: check.origin,
			action: "save",
			expectedRevision: current.revision,
			...body,
		}),
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.env.BACKEND_BASE_URL = undefined;
	mocks.session.mockResolvedValue({
		token: "old-token",
		backendRevision: current.revision,
	});
	mocks.admin.mockResolvedValue(true);
	mocks.target.mockResolvedValue(current);
	mocks.inspect.mockResolvedValue({
		version: check.version,
		compatibility: check.compatibility,
		warnings: [],
	});
	mocks.change.mockResolvedValue(true);
});
describe("installation connection administration", () => {
	it("shows the current connection to administrators", async () => {
		const response = await GET(
			new NextRequest("https://console.test/_hubuum-bff/connection"),
		);
		expect(await response.json()).toEqual({ ...current, managed: false });
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
	it.each(["anonymous", "non-admin", "cross-origin"])(
		"rejects %s before contacting a candidate",
		async (kind) => {
			if (kind === "anonymous") mocks.session.mockResolvedValue(null);
			if (kind === "non-admin") mocks.admin.mockResolvedValue(false);
			expect(
				(
					await POST(
						request(
							{},
							kind === "cross-origin" ? "https://other.test" : undefined,
						),
					)
				).status,
			).toBe(kind === "anonymous" ? 401 : 403);
			expect(mocks.inspect).not.toHaveBeenCalled();
			expect(mocks.change).not.toHaveBeenCalled();
		},
	);
	it("keeps deployment-managed connections read-only", async () => {
		mocks.env.BACKEND_BASE_URL = current.origin;
		expect((await POST(request())).status).toBe(409);
		expect(mocks.inspect).not.toHaveBeenCalled();
	});
	it("checks without saving and requires confirmation even for the supported release", async () => {
		expect((await POST(request({ action: "check" }))).status).toBe(200);
		const response = await POST(request());
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ ...check, saved: false });
		expect(mocks.change).not.toHaveBeenCalled();
	});
	it("rechecks, saves atomically, then clears the current browser's session cookie", async () => {
		expect((await POST(request({ confirmation: check }))).status).toBe(200);
		expect(mocks.inspect).toHaveBeenCalledOnce();
		expect(mocks.change).toHaveBeenCalledWith(current, check.origin);
		expect(mocks.clear).toHaveBeenCalledOnce();
	});
	it("requires fresh confirmation after a candidate's compatibility changes", async () => {
		mocks.inspect.mockResolvedValue({
			version: "0.0.19",
			compatibility: "incompatible",
			warnings: ["Requires patched authentication"],
		});
		expect((await POST(request({ confirmation: check }))).status).toBe(409);
		expect(mocks.change).not.toHaveBeenCalled();
	});
	it("does not overwrite a connection changed since this form opened", async () => {
		expect(
			(
				await POST(
					request({ expectedRevision: "outdated", confirmation: check }),
				)
			).status,
		).toBe(409);
		expect(mocks.inspect).not.toHaveBeenCalled();
		mocks.change.mockResolvedValue(false);
		expect((await POST(request({ confirmation: check }))).status).toBe(409);
		expect(mocks.clear).not.toHaveBeenCalled();
	});
});
