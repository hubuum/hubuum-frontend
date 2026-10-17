import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdvancedSearch } from "@/lib/api/advanced-search";
import { hubuumBffPath } from "@/lib/api/frontend";
import type { StructuredSearchRequest } from "@/lib/api/generated/models";

const request: StructuredSearchRequest = {
	version: 1,
	target: { kind: "object" },
	filter: {
		op: "field",
		predicate: { field: "name", operator: "equals", value: "server" },
	},
	include_total: true,
};
const resource = {
	id: 1,
	name: "server",
	description: "",
	updated_at: "2026-10-17T12:00:00",
	hubuum_class_id: 2,
	collection_id: 3,
};
afterEach(() => vi.unstubAllGlobals());

describe("structured search transport", () => {
	it("posts the precise query through the BFF with credentials and cancellation", async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					version: 1,
					kind: "object",
					results: [{ kind: "object", resource }],
					next: "opaque",
					total: 4,
				}),
			),
		);
		vi.stubGlobal("fetch", fetch);
		const signal = new AbortController().signal;
		const result = await fetchAdvancedSearch(request, signal);
		expect(result.next).toBe("opaque");
		expect(fetch).toHaveBeenCalledWith(
			hubuumBffPath("/api/v1/search"),
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				signal,
				body: JSON.stringify(request),
			}),
		);
	});
	it.each([400, 401, 403, 404, 405, 500])(
		"does not retry or broaden a failed query (%s)",
		async (status) => {
			const fetch = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ message: "Specific backend error" }), {
					status,
				}),
			);
			vi.stubGlobal("fetch", fetch);
			await expect(fetchAdvancedSearch(request)).rejects.toThrow(
				"Specific backend error",
			);
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);
	it.each([
		null,
		{ version: 2, kind: "object", results: [] },
		{ version: 1, kind: "collection", results: [] },
		{
			version: 1,
			kind: "object",
			results: [{ kind: "object", resource: { id: "1", name: "server" } }],
		},
		{ version: 1, kind: "object", results: [], next: 5 },
		{ version: 1, kind: "object", results: [], total: -1 },
		{
			version: 1,
			kind: "object",
			results: [{ kind: "object", resource: { ...resource, description: {} } }],
		},
		{
			version: 1,
			kind: "object",
			results: [{ kind: "object", resource: { ...resource, updated_at: {} } }],
		},
	])("rejects malformed response %j", async (payload) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))),
		);
		await expect(fetchAdvancedSearch(request)).rejects.toThrow(
			"invalid structured search response",
		);
	});
});
