import { describe, expect, it } from "vitest";

import {
	getSessionTouchIntervalMs,
	shouldTouchSession,
} from "@/lib/auth/session-touch";

describe("getSessionTouchIntervalMs", () => {
	it("caps long-lived sessions at five minutes", () => {
		expect(getSessionTouchIntervalMs(8 * 60 * 60)).toBe(5 * 60 * 1_000);
	});

	it("refreshes short-lived sessions after one quarter of their TTL", () => {
		expect(getSessionTouchIntervalMs(8)).toBe(2_000);
		expect(getSessionTouchIntervalMs(1)).toBe(250);
	});
});

describe("shouldTouchSession", () => {
	it("does not refresh a recently touched session", () => {
		expect(shouldTouchSession(10_000, 11_999, 8)).toBe(false);
	});

	it("refreshes once the configured interval has elapsed", () => {
		expect(shouldTouchSession(10_000, 12_000, 8)).toBe(true);
	});

	it("reanchors malformed or future timestamps", () => {
		expect(shouldTouchSession(Number.NaN, 10_000, 8)).toBe(true);
		expect(shouldTouchSession(11_000, 10_000, 8)).toBe(true);
	});
});
