import { afterEach, expect, it, vi } from "vitest";
import {
	streamAdvancedSearch,
	streamUnifiedSearch,
} from "@/lib/api/search-stream";
const resource = {
	id: 3,
	name: "Servers",
	description: "",
	updated_at: "2026-10-01T00:00:00Z",
};
const request = {
	version: 1,
	target: { kind: "collection" as const },
	limit: 25,
};
const event = (name: string, data: unknown) =>
	`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
function mock(body: string) {
	const fetch = vi
		.fn()
		.mockResolvedValue(
			new Response(body, { headers: { "content-type": "text/event-stream" } }),
		);
	vi.stubGlobal("fetch", fetch);
	return fetch;
}
afterEach(() => vi.unstubAllGlobals());
it("assembles structured results while exposing cursors only on done", async () => {
	const fetch = mock(
		event("started", { version: 1, kind: "collection" }) +
			event("result", { kind: "collection", resource }) +
			event("done", {
				version: 1,
				kind: "collection",
				next: "opaque",
				total: 4,
				page_limit: 25,
			}),
	);
	const progress: unknown[] = [];
	const result = await streamAdvancedSearch(request, (data) =>
		progress.push(data),
	);
	expect(result.next).toBe("opaque");
	expect(result.total).toBe(4);
	expect(progress).toHaveLength(2);
	expect(progress[1]).toMatchObject({
		next: null,
		total: null,
		results: [{ kind: "collection", resource }],
	});
	expect(fetch.mock.calls[0][0]).toBe(
		"/_hubuum-bff/hubuum/api/v1/search/stream",
	);
	expect(fetch.mock.calls[0][1]).toMatchObject({
		method: "POST",
		credentials: "include",
		body: JSON.stringify(request),
	});
});
it("assembles discovery batches and retains flags and cursors", async () => {
	mock(
		event("started", { query: "server" }) +
			event("batch", {
				kind: "collections",
				collections: [resource],
				classes: [],
				objects: [],
				next: "next",
			}) +
			event("done", { query: "server" }),
	);
	const result = await streamUnifiedSearch(
		{
			q: "server",
			kinds: ["collection"],
			cursorCollections: "first",
			searchObjectData: true,
		},
		() => undefined,
	);
	expect(result.next.collections).toBe("next");
	expect(result.results.collections).toHaveLength(1);
});
it.each(["error", "duplicate", "missing"])(
	"rejects %s terminal states without retry",
	async (mode) => {
		const start = event("started", { query: "server" });
		const batch = event("batch", {
			kind: "collections",
			collections: [resource],
			classes: [],
			objects: [],
		});
		const fetch = mock(
			start +
				(mode === "missing"
					? event("done", { query: "server" })
					: batch +
						(mode === "error"
							? event("error", { message: "Search failed" })
							: batch)),
		);
		await expect(
			streamUnifiedSearch(
				{ q: "server", kinds: ["collection"] },
				() => undefined,
			),
		).rejects.toThrow();
		expect(fetch).toHaveBeenCalledTimes(1);
	},
);
