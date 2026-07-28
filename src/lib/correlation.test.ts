import { describe, expect, it } from "vitest";

import {
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";

describe("correlation IDs", () => {
	it("generates a cryptographically secure normalized UUID", () => {
		const correlationId = generateCorrelationId();

		expect(correlationId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(normalizeCorrelationId(correlationId)).toBe(correlationId);
	});
});
