import { describe, expect, it } from "vitest";

import { copySafeUpstreamResponseHeaders } from "@/lib/api/proxy-response-headers";

describe("copySafeUpstreamResponseHeaders", () => {
	it("forwards backup and cache headers", () => {
		const upstream = new Headers({
			"cache-control": "private, no-store",
			"content-disposition": 'attachment; filename="backup.json"',
			digest: "sha-256=:abc:",
			"x-hubuum-backup-sha256": "abc",
		});
		const downstream = new Headers();

		copySafeUpstreamResponseHeaders(upstream, downstream);

		expect(downstream.get("cache-control")).toBe("private, no-store");
		expect(downstream.get("content-disposition")).toBe(
			'attachment; filename="backup.json"',
		);
		expect(downstream.get("digest")).toBe("sha-256=:abc:");
		expect(downstream.get("x-hubuum-backup-sha256")).toBe("abc");
	});

	it("does not forward credentials or cookies", () => {
		const upstream = new Headers({
			authorization: "Bearer secret",
			"set-cookie": "secret=value",
		});
		const downstream = new Headers();

		copySafeUpstreamResponseHeaders(upstream, downstream);

		expect([...downstream]).toEqual([]);
	});
});
