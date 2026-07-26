import { describe, expect, it } from "vitest";

import {
	assertRemoteTargetHeaderAllowed,
	validateRemoteTargetHeaders,
} from "@/lib/remote-target-headers";

describe("remote target header validation", () => {
	it("accepts application-defined headers", () => {
		expect(() =>
			validateRemoteTargetHeaders({
				"Content-Type": "application/json",
				"X-Hubuum-Object": "{{ object.name }}",
			}),
		).not.toThrow();
	});

	it("rejects transport-controlled header templates case-insensitively", () => {
		expect(() =>
			validateRemoteTargetHeaders({ "content-length": "10" }),
		).toThrowError(
			"Headers template cannot set the transport-controlled content-length header.",
		);
		expect(() =>
			validateRemoteTargetHeaders({ "Proxy-Connection": "keep-alive" }),
		).toThrowError(/Proxy-Connection/);
	});

	it("rejects transport-controlled API-key headers", () => {
		expect(() =>
			assertRemoteTargetHeaderAllowed("Host", "API key authentication"),
		).toThrowError(
			"API key authentication cannot set the transport-controlled Host header.",
		);
	});
});
