import { describe, expect, it } from "vitest";

import {
	formatTokenLifecycleStatus,
	getTokenLifecycleStatus,
} from "@/lib/token-lifecycle";

const now = new Date("2026-08-04T12:00:00Z");

describe("token lifecycle", () => {
	it("identifies active and expired tokens from their expiry", () => {
		expect(
			getTokenLifecycleStatus({ expires_at: "2026-08-05T12:00:00Z" }, now),
		).toBe("active");
		expect(
			getTokenLifecycleStatus({ expires_at: "2026-08-03T12:00:00Z" }, now),
		).toBe("expired");
		expect(formatTokenLifecycleStatus("expired")).toBe("Expired");
	});

	it("gives revocation precedence over expiry", () => {
		expect(
			getTokenLifecycleStatus(
				{
					expires_at: "2026-08-03T12:00:00Z",
					revoked_at: "2026-08-02T12:00:00Z",
				},
				now,
			),
		).toBe("revoked");
	});

	it("treats missing or invalid expiries as active", () => {
		expect(getTokenLifecycleStatus({}, now)).toBe("active");
		expect(getTokenLifecycleStatus({ expires_at: "invalid" }, now)).toBe(
			"active",
		);
	});
});
