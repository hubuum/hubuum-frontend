import { describe, expect, it } from "vitest";

import {
	extendCursorTrail,
	hasPreviousCursorInTrail,
	normalizeCursorPageLimit,
	parseCursorTrail,
	previousCursorFromTrail,
} from "@/lib/cursor-pagination";
import { MAX_PAGE_LIMIT_SENTINEL } from "@/lib/server-page-limit";

describe("cursor pagination", () => {
	it("normalizes malformed and out-of-range page limits", () => {
		expect(normalizeCursorPageLimit(null, 100)).toBe(100);
		expect(normalizeCursorPageLimit("not-a-number", 100)).toBe(100);
		expect(normalizeCursorPageLimit("10.5", 100)).toBe(100);
		expect(normalizeCursorPageLimit("0", 100)).toBe(1);
		expect(normalizeCursorPageLimit("-25", 100)).toBe(1);
		expect(normalizeCursorPageLimit("999999999999", 100)).toBe(
			MAX_PAGE_LIMIT_SENTINEL,
		);
		expect(normalizeCursorPageLimit("50", Number.NaN)).toBe(50);
	});

	it("uses the URL cursor to reconcile Back, Forward, and Previous", () => {
		let trail = extendCursorTrail([], undefined, "page-2");
		trail = extendCursorTrail(trail, "page-2", "page-3");

		expect(trail).toEqual([null, "page-2", "page-3"]);
		expect(hasPreviousCursorInTrail(trail, "page-2")).toBe(true);
		expect(previousCursorFromTrail(trail, "page-2")).toBeUndefined();
		expect(previousCursorFromTrail(trail, "page-3")).toBe("page-2");
	});

	it("truncates the forward trail when Next branches after Back", () => {
		const trail = extendCursorTrail(
			[null, "page-2", "page-3"],
			"page-2",
			"replacement-page-3",
		);

		expect(trail).toEqual([null, "page-2", "replacement-page-3"]);
	});

	it("uses the backend previous cursor for direct or restored URLs", () => {
		expect(
			previousCursorFromTrail([], "direct-page", "backend-previous"),
		).toBe("backend-previous");
	});

	it("rejects malformed persisted trails", () => {
		expect(parseCursorTrail("not-json")).toEqual([]);
		expect(parseCursorTrail('{"cursor":"page-2"}')).toEqual([]);
		expect(
			parseCursorTrail('[null,"page-2",42,"",{"cursor":"page-3"}]'),
		).toEqual([null, "page-2"]);
	});
});
