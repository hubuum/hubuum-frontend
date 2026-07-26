import { afterEach, describe, expect, it, vi } from "vitest";

import {
	resolveDirectTokenResourceNames,
	resolveObjectTokenResourceNames,
} from "@/lib/api/token-resource-names";

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { "Content-Type": "application/json" },
		status,
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("token resource name resolution", () => {
	it("resolves collection and class IDs through their direct endpoints", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith("/api/v1/collections/17")) {
					return jsonResponse({
						id: 17,
						name: "Infrastructure",
					});
				}
				if (url.endsWith("/api/v1/classes/23")) {
					return jsonResponse({
						id: 23,
						name: "Server",
					});
				}
				return jsonResponse({ message: "Not found" }, 404);
			}),
		);

		await expect(
			resolveDirectTokenResourceNames([
				{ kind: "collection", id: 17 },
				{ kind: "class", id: 23 },
				{ kind: "class", id: 404 },
			]),
		).resolves.toEqual({
			"collection:17": "Infrastructure",
			"class:23": "Server",
		});
	});

	it("resolves objects only through classes present in the same scope", async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/api/v1/classes/23/99")) {
				return jsonResponse({ id: 99, name: "api-01" });
			}
			return jsonResponse({ message: "Not found" }, 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			resolveObjectTokenResourceNames([
				{ kind: "class", id: 23 },
				{ kind: "object", id: 99 },
				{ kind: "object", id: 101 },
			]),
		).resolves.toEqual({
			"object:99": "api-01",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const [input] of fetchMock.mock.calls) {
			expect(String(input)).toContain("/api/v1/classes/23/");
		}
	});

	it("does not search globally for an object without a scoped class", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			resolveObjectTokenResourceNames([{ kind: "object", id: 99 }]),
		).resolves.toEqual({});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
