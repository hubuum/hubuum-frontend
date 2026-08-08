import { describe, expect, it } from "vitest";

import {
	buildSessionExpiryLoginPath,
	isSessionExpiryResponse,
} from "@/lib/session-expiry";

describe("session expiry", () => {
	it.each([
		"/_hubuum-bff/hubuum/api/v1/events",
		"/_hubuum-bff/classes/7/objects",
		"/_hubuum-bff/reports/latest",
		"/_hubuum-bff/settings",
	])("recognizes a protected BFF 401 from %s", (path) => {
		expect(
			isSessionExpiryResponse(new URL(path, "https://hubuum.invalid"), 401),
		).toBe(true);
	});

	it("does not treat authorization failures or auth endpoints as expiry", () => {
		expect(
			isSessionExpiryResponse(
				new URL(
					"/_hubuum-bff/hubuum/api/v1/events",
					"https://hubuum.invalid",
				),
				403,
			),
		).toBe(false);
		expect(
			isSessionExpiryResponse(
				new URL("/_hubuum-bff/auth/login", "https://hubuum.invalid"),
				401,
			),
		).toBe(false);
		expect(
			isSessionExpiryResponse(
				new URL("/api/v1/events", "https://hubuum.invalid"),
				401,
			),
		).toBe(false);
	});

	it("preserves the protected return path and includes an expiry reason", () => {
		expect(buildSessionExpiryLoginPath("/objects?classId=7#results")).toBe(
			"/login?error=session_expired&next=%2Fobjects%3FclassId%3D7%23results",
		);
	});
});
