import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchObjectHistoryByNamePage } from "@/lib/api/events";
import { objectNameHistoryHref } from "@/lib/resource-history";

afterEach(() => vi.unstubAllGlobals());

describe("object history by exact name", () => {
	it.each(["123", " server / ?,#%雪 ", "", "   "])(
		"preserves the literal name %j and opaque cursor through the BFF",
		async (name) => {
			const snapshots = [
				{ id: 27, history_id: 104, name, op: "I", revision: 1 },
				{ id: 12, history_id: 103, name, op: "D", revision: 2 },
				{ id: 12, history_id: 102, name, op: "U", revision: 2 },
			];
			const fetch = vi.fn().mockResolvedValue(
				new Response(JSON.stringify(snapshots), {
					headers: { "X-Next-Cursor": "next+/= ?" },
				}),
			);
			vi.stubGlobal("fetch", fetch);
			expect(
				await fetchObjectHistoryByNamePage(3, name, "opaque+/= ?"),
			).toEqual({
				items: snapshots,
				nextCursor: "next+/= ?",
				totalCount: null,
			});
			const [url, options] = fetch.mock.calls[0];
			const request = new URL(url, "http://localhost");
			expect(request.pathname).toBe(
				"/_hubuum-bff/hubuum/api/v1/classes/3/objects/history",
			);
			expect(Object.fromEntries(request.searchParams)).toEqual({
				name,
				cursor: "opaque+/= ?",
				limit: "25",
				sort: "-history_id",
				include_total: "false",
			});
			expect(options).toMatchObject({ credentials: "include" });
			expect(fetch).toHaveBeenCalledTimes(1);
			const link = new URL(objectNameHistoryHref(3, name), "http://localhost");
			expect(link.pathname).toBe("/classes/3/objects/history");
			expect(link.searchParams.get("name")).toBe(name);
		},
	);

	it("distinguishes an unsubmitted search from an empty name", () => {
		expect(objectNameHistoryHref(3)).toBe("/classes/3/objects/history");
		expect(objectNameHistoryHref(3, "")).toBe(
			"/classes/3/objects/history?name=",
		);
	});

	it("returns an empty authorized result without resolving live objects", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response("[]"));
		vi.stubGlobal("fetch", fetch);
		expect(await fetchObjectHistoryByNamePage(3, "deleted")).toEqual({
			items: [],
			nextCursor: null,
			totalCount: null,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0][0]).not.toContain("cursor=");
	});

	it.each([404, 405, 501])(
		"reports unsupported servers (%s)",
		async (status) => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValue(new Response("Invalid object ID", { status })),
			);
			await expect(fetchObjectHistoryByNamePage(3, "server")).rejects.toThrow(
				"By-name history is unavailable on this server",
			);
		},
	);

	it.each([400, 401, 403, 500])(
		"keeps query, authorization and server failures visible (%s)",
		async (status) => {
			const fetch = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ message: "History request denied" }), {
					status,
				}),
			);
			vi.stubGlobal("fetch", fetch);
			await expect(fetchObjectHistoryByNamePage(3, "server")).rejects.toThrow(
				"History request denied",
			);
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);

	it("recognizes the released server's objects-as-ID routing error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: "Bad Request",
						message: 'Path deserialize error: can not parse "objects" to a i32',
					}),
					{ status: 400 },
				),
			),
		);
		await expect(fetchObjectHistoryByNamePage(3, "server")).rejects.toThrow(
			"By-name history is unavailable on this server",
		);
	});
});
