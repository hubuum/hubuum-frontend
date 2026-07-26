import { describe, expect, it } from "vitest";

import { normalizeReturnPath } from "@/lib/return-path";

describe("normalizeReturnPath", () => {
	it("keeps local paths, query strings, and fragments", () => {
		expect(normalizeReturnPath("/reports/7?object_id=9#result")).toBe(
			"/reports/7?object_id=9#result",
		);
	});

	it("rejects absolute, protocol-relative, and malformed targets", () => {
		expect(normalizeReturnPath("https://example.com/report")).toBe("/app");
		expect(normalizeReturnPath("//example.com/report")).toBe("/app");
		expect(normalizeReturnPath("reports/7")).toBe("/app");
		expect(normalizeReturnPath("http://[")).toBe("/app");
	});
});
