import { describe, expect, it } from "vitest";

import {
	MAX_PAGE_LIMIT_SENTINEL,
	resolveServerPageLimit,
	V0_0_2_PAGE_LIMIT_FALLBACK,
} from "@/lib/server-page-limit";

describe("server page limits", () => {
	it("leaves explicit page sizes unchanged", () => {
		expect(resolveServerPageLimit(50)).toBe(50);
	});

	it("uses the v0.0.2 fallback for MAX", () => {
		expect(resolveServerPageLimit(MAX_PAGE_LIMIT_SENTINEL)).toBe(
			V0_0_2_PAGE_LIMIT_FALLBACK,
		);
	});

	it("prefers a future advertised server cap", () => {
		expect(resolveServerPageLimit(MAX_PAGE_LIMIT_SENTINEL, 500)).toBe(500);
	});
});
