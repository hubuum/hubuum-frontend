import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";

function mutationRequest(
	headers: HeadersInit = {},
	url = "https://console.example/_hubuum-bff/settings",
): NextRequest {
	return new NextRequest(url, {
		headers,
		method: "PATCH",
	});
}

describe("BFF mutation origin guard", () => {
	it("accepts an exact same-origin Origin", () => {
		expect(
			rejectCrossOriginBffMutation(
				mutationRequest({ Origin: "https://console.example" }),
			),
		).toBeNull();
	});

	it("accepts same-origin Fetch Metadata when Origin is absent", () => {
		expect(
			rejectCrossOriginBffMutation(
				mutationRequest({ "Sec-Fetch-Site": "same-origin" }),
			),
		).toBeNull();
	});

	it("uses the external origin forwarded by a TLS-terminating proxy", () => {
		expect(
			rejectCrossOriginBffMutation(
				mutationRequest(
					{
						Host: "frontend:3000",
						Origin: "https://console.example",
						"X-Forwarded-Host": "console.example:443",
						"X-Forwarded-Proto": "https",
					},
					"http://frontend:3000/_hubuum-bff/settings",
				),
			),
		).toBeNull();
	});

	it.each([
		["cross-origin Origin", { Origin: "https://attacker.example" }],
		["opaque Origin", { Origin: "null" }],
		["same-site sibling metadata", { "Sec-Fetch-Site": "same-site" }],
		["cross-site metadata", { "Sec-Fetch-Site": "cross-site" }],
		["missing metadata", {}],
	])("rejects %s", async (_label, headers) => {
		const response = rejectCrossOriginBffMutation(mutationRequest(headers));

		expect(response?.status).toBe(403);
		await expect(response?.json()).resolves.toEqual({
			error: "Forbidden",
			message: "Same-origin request metadata is required.",
		});
	});

	it("does not apply to safe methods", () => {
		const request = new NextRequest(
			"https://console.example/_hubuum-bff/settings",
		);
		expect(rejectCrossOriginBffMutation(request)).toBeNull();
	});
});
