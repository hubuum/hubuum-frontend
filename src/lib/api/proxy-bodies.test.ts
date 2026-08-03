import { describe, expect, it } from "vitest";

import {
	getProxyRequestBody,
	getProxyResponseBody,
} from "@/lib/api/proxy-bodies";

function byteStream(bytes: number[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(Uint8Array.from(bytes));
			controller.close();
		},
	});
}

async function readBytes(
	body: ReadableStream<Uint8Array> | null | undefined,
): Promise<number[]> {
	if (!body) {
		return [];
	}

	return [...new Uint8Array(await new Response(body).arrayBuffer())];
}

describe("getProxyRequestBody", () => {
	it("omits request bodies for safe methods", () => {
		const body = byteStream([1, 2, 3]);

		expect(getProxyRequestBody("GET", body)).toBeUndefined();
		expect(getProxyRequestBody("head", body)).toBeUndefined();
	});

	it("preserves arbitrary request bytes for mutating methods", async () => {
		const body = byteStream([0, 255, 128, 10]);
		const proxied = getProxyRequestBody("POST", body);

		expect(proxied).toBe(body);
		expect(await readBytes(proxied)).toEqual([0, 255, 128, 10]);
	});
});

describe("getProxyResponseBody", () => {
	it.each([204, 205, 304])("omits response bodies for status %s", (status) => {
		expect(getProxyResponseBody(status, byteStream([1]))).toBeNull();
	});

	it("preserves arbitrary upstream response bytes", async () => {
		const body = byteStream([0, 255, 128, 10]);
		const proxied = getProxyResponseBody(200, body);

		expect(proxied).toBe(body);
		expect(await readBytes(proxied)).toEqual([0, 255, 128, 10]);
	});
});
