import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchExpandedClass } from "@/lib/api/classes";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("fetchExpandedClass", () => {
	it("requests collection context from the canonical class point route", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					collection: { id: 7, name: "Infrastructure" },
					collection_id: 7,
					id: 12,
					name: "Server",
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchExpandedClass(12)).resolves.toMatchObject({
			collection: { id: 7, name: "Infrastructure" },
			id: 12,
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/_hubuum-bff/hubuum/api/v1/classes/12?include=collection",
			{ credentials: "include" },
		);
	});

	it("rejects a canonical response without collection context", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(JSON.stringify({ id: 12, name: "Server" }), {
					status: 200,
				}),
			),
		);

		await expect(fetchExpandedClass(12)).rejects.toThrow(
			"class without collection context",
		);
	});
});
