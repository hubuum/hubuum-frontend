import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backendFetchRaw: vi.fn(),
	clearSessionCookie: vi.fn(),
	destroySession: vi.fn(),
	getSessionFromRequest: vi.fn(),
}));

vi.mock("@/lib/api/backend", () => ({
	backendFetchRaw: mocks.backendFetchRaw,
}));

vi.mock("@/lib/auth/session", () => ({
	clearSessionCookie: mocks.clearSessionCookie,
	destroySession: mocks.destroySession,
	getSessionFromRequest: mocks.getSessionFromRequest,
}));

import { GET } from "@/app/%5Fhubuum-bff/classes/[classId]/relations/route";

const session = {
	createdAt: Date.now(),
	lastSeen: Date.now(),
	sid: "session-id",
	token: "backend-token",
	username: "admin",
};

function routeContext(classId: string) {
	return { params: Promise.resolve({ classId }) };
}

describe("class relations helper route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSessionFromRequest.mockResolvedValue(session);
	});

	it("forwards GET pagination parameters and response headers", async () => {
		mocks.backendFetchRaw.mockResolvedValue(
			Response.json([{ id: 301 }], {
				headers: {
					ETag: '"relations-page"',
					"X-Next-Cursor": "next-page",
					"X-Page-Limit": "250",
					"X-Prev-Cursor": "previous-page",
					"X-Total-Count": "301",
				},
			}),
		);
		const request = new NextRequest(
			"https://console.example/_hubuum-bff/classes/7/relations?limit=250&sort=id.asc&cursor=opaque%2Fcursor%3Fx%3D1&include_total=false",
			{
				headers: {
					"X-Correlation-Id": "78a802c3-5427-4a0e-a64a-90189f393393",
				},
			},
		);

		const response = await GET(request, routeContext("7"));

		expect(mocks.backendFetchRaw).toHaveBeenCalledWith(
			"/api/v1/classes/7/related/relations/?limit=250&sort=id.asc&cursor=opaque%2Fcursor%3Fx%3D1&include_total=false",
			expect.objectContaining({
				correlationId: "78a802c3-5427-4a0e-a64a-90189f393393",
				method: "GET",
				token: "backend-token",
			}),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual([{ id: 301 }]);
		expect(response.headers.get("etag")).toBe('"relations-page"');
		expect(response.headers.get("X-Next-Cursor")).toBe("next-page");
		expect(response.headers.get("X-Prev-Cursor")).toBe("previous-page");
		expect(response.headers.get("X-Total-Count")).toBe("301");
		expect(response.headers.get("X-Page-Limit")).toBe("250");
	});
});
