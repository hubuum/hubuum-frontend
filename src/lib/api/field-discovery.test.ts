import { afterEach, expect, it, vi } from "vitest";
import { fetchClassFieldInventory } from "@/lib/api/field-discovery";
import {
	fetchSchemaProfile,
	submitSchemaProfile,
} from "@/lib/api/schema-profiling";

afterEach(() => vi.unstubAllGlobals());
it("requests bounded discovery by class identity through the BFF", async () => {
	const fetch = vi.fn(
		async () => new Response('{"fields":[]}', { status: 200 }),
	);
	vi.stubGlobal("fetch", fetch);
	const signal = new AbortController().signal;
	await fetchClassFieldInventory(
		42,
		{ limit: 7, depth: 0, containers: false },
		signal,
	);
	const [url, options] = fetch.mock.calls[0] as unknown as [
		string,
		RequestInit,
	];
	expect(url).toBe(
		"/_hubuum-bff/hubuum/api/v1/classes/42/fields?limit=7&depth=0&containers=false",
	);
	expect(options).toMatchObject({
		method: "GET",
		credentials: "include",
		signal,
	});
});
it.each(["strict", "balanced", "expansive"] as const)(
	"submits the %s preset with retry identity",
	async (preset) => {
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response('{"id":7}', { status: 202 }),
		);
		vi.stubGlobal("fetch", fetch);
		await submitSchemaProfile(42, { preset, sample_limit: 7 });
		expect(fetch).toHaveBeenCalledWith(
			"/_hubuum-bff/hubuum/api/v1/classes/42/schema/profiles",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				body: JSON.stringify({ preset, sample_limit: 7 }),
				headers: expect.objectContaining({
					"Idempotency-Key": expect.stringMatching(
						/^hubuum-schema-profile-42-/,
					),
				}),
			}),
		);
	},
);
it.each([403, 404, 410])("preserves report status %i", async (status) => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response('{"message":"Unavailable"}', { status })),
	);
	await expect(fetchSchemaProfile(42, 7)).rejects.toMatchObject({ status });
});
