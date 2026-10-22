import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTokenPage } from "@/lib/api/token-overview";
import { fetchTokenActivity } from "@/lib/api/token-activity";

afterEach(() => vi.unstubAllGlobals());

describe("token overview requests", () => {
	it.each(["me", 7] as const)(
		"pages %s tokens with lifecycle, sort and exact totals",
		async (principal) => {
			const fetch = vi
				.fn()
				.mockResolvedValue(
					Response.json([], {
						headers: { "X-Total-Count": "52", "X-Next-Cursor": "next+page=" },
					}),
				);
			vi.stubGlobal("fetch", fetch);
			const { signal } = new AbortController();
			await expect(
				fetchTokenPage(
					principal,
					"expired",
					"-issued_at",
					"previous+page=",
					signal,
				),
			).resolves.toEqual({ tokens: [], total: 52, nextCursor: "next+page=" });
			const [path, options] = fetch.mock.calls[0];
			const url = new URL(path, "http://localhost");
			expect(url.pathname).toBe(
				`/_hubuum-bff/hubuum/api/v1/iam/${principal === "me" ? "me" : "principals/7"}/tokens`,
			);
			expect(Object.fromEntries(url.searchParams)).toEqual({
				state: "expired",
				sort: "-issued_at",
				cursor: "previous+page=",
				limit: "25",
				include_total: "true",
			});
			expect(options).toMatchObject({
				credentials: "include",
				cache: "no-store",
				signal,
			});
		},
	);
	it.each([null, "not-a-count"])(
		"does not invent totals from %s",
		async (count) => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValue(
						Response.json([], {
							headers: count === null ? {} : { "X-Total-Count": count },
						}),
					),
			);
			expect(
				(await fetchTokenPage("me", "active", "-issued_at", undefined)).total,
			).toBeNull();
		},
	);
	it("surfaces list errors instead of reporting zero tokens", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ message: "Access denied" }, { status: 403 }),
				),
		);
		await expect(
			fetchTokenPage("me", "active", "-issued_at", undefined),
		).rejects.toThrow("Access denied");
	});
	it("requests only one source for an optional overview summary", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(Response.json({ total: 32, sources: [] }));
		vi.stubGlobal("fetch", fetch);
		await fetchTokenActivity(7, 42, 0, undefined, 1);
		expect(fetch.mock.calls[0][0]).toContain("?offset=0&limit=1");
	});
});
