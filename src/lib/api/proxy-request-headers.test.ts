import { describe, expect, it } from "vitest";

import { copySafeIncomingRequestHeaders } from "@/lib/api/proxy-request-headers";

describe("copySafeIncomingRequestHeaders", () => {
	it("forwards content negotiation, revision, and restore headers", () => {
		const incoming = new Headers({
			accept: "application/json",
			"content-type": "application/json-patch+json",
			"if-match": '"resource:7"',
			"x-hubuum-restore-capability": "restore-capability",
		});
		const upstream = new Headers();

		copySafeIncomingRequestHeaders(incoming, upstream);

		expect(Object.fromEntries(upstream)).toEqual(Object.fromEntries(incoming));
	});

	it("does not forward browser credentials or cookies", () => {
		const incoming = new Headers({
			authorization: "Bearer browser-secret",
			cookie: "hubuum.sid=secret",
		});
		const upstream = new Headers();

		copySafeIncomingRequestHeaders(incoming, upstream);

		expect([...upstream]).toEqual([]);
	});
});
