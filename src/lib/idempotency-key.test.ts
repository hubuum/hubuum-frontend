import { describe, expect, it } from "vitest";

import {
	MAX_IDEMPOTENCY_KEY_BYTES,
	normalizeIdempotencyKey,
} from "@/lib/idempotency-key";

describe("normalizeIdempotencyKey", () => {
	it("omits blank keys and trims present keys", () => {
		expect(normalizeIdempotencyKey()).toBeUndefined();
		expect(normalizeIdempotencyKey("   ")).toBeUndefined();
		expect(normalizeIdempotencyKey(" import-42 ")).toBe("import-42");
	});

	it("accepts a key at the byte limit", () => {
		expect(
			normalizeIdempotencyKey("a".repeat(MAX_IDEMPOTENCY_KEY_BYTES)),
		).toHaveLength(MAX_IDEMPOTENCY_KEY_BYTES);
	});

	it("rejects keys over the UTF-8 byte limit", () => {
		expect(() =>
			normalizeIdempotencyKey("ø".repeat(128)),
		).toThrowError("Idempotency keys must be 255 bytes or fewer.");
	});
});
