import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchAllClassOptions,
	fetchAllCollectionOptions,
	fetchResourceOption,
	fetchResourceOptions,
} from "@/lib/api/resource-options";

afterEach(() => vi.unstubAllGlobals());

describe("resource options", () => {
	it("includes class options from later pages with collection context", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json(
					[{ id: 1, name: "First", collection: { id: 5, name: "West" } }],
					{ headers: { "X-Next-Cursor": "later" } },
				),
			)
			.mockResolvedValueOnce(
				Response.json([
					{ id: 999, name: "Last", collection: { id: 6, name: "East" } },
				]),
			);
		vi.stubGlobal("fetch", fetchMock);
		const options = await fetchAllClassOptions();
		expect(options.map((item) => item.id)).toEqual([1, 999]);
		expect(options[1].collection.name).toBe("East");
		const url = new URL(fetchMock.mock.calls[1][0], "https://console.test");
		expect(url.searchParams.get("cursor")).toBe("later");
		// Class lists already expand collections and reject an include parameter.
		expect(url.searchParams.has("include")).toBe(false);
		expect(url.searchParams.get("include_total")).toBe("false");
	});
	it("loads subsequent collection pages without asking for exact totals", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json([{ id: 1, name: "First" }], {
					headers: { "X-Next-Cursor": "next page" },
				}),
			)
			.mockResolvedValueOnce(
				Response.json([{ id: 999, name: "Beyond the old limit" }]),
			);
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		const items = await fetchAllCollectionOptions(controller.signal);
		expect(items.map((item) => item.id)).toEqual([1, 999]);
		const nextUrl = new URL(fetchMock.mock.calls[1][0], "https://console.test");
		expect(nextUrl.searchParams.get("cursor")).toBe("next page");
		expect(nextUrl.searchParams.get("include_total")).toBe("false");
		expect(fetchMock.mock.calls[1][1].signal).toBe(controller.signal);
	});

	it("searches classes across the full dataset and follows the class cursor", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				query: "router",
				results: { classes: [{ id: 501, name: "Router" }] },
				next: { classes: "more" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		const page = await fetchResourceOptions(
			"class",
			" router ",
			"previous",
			controller.signal,
		);
		const url = new URL(fetchMock.mock.calls[0][0], "https://console.test");
		expect(url.searchParams.get("kinds")).toBe("class");
		expect(url.searchParams.get("q")).toBe("router");
		expect(url.searchParams.get("cursor_classes")).toBe("previous");
		expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
		expect(page.nextCursor).toBe("more");
		expect(page.items[0].id).toBe(501);
	});

	it("loads a selected resource directly and rejects invalid IDs before requesting", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				id: 999,
				name: "Selected",
				collection: { id: 1, name: "Root" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		await expect(fetchResourceOption("class", "999")).resolves.toMatchObject({
			id: 999,
		});
		expect(fetchMock.mock.calls[0][0]).toBe(
			"/_hubuum-bff/hubuum/api/v1/classes/999?include=collection",
		);
		await expect(fetchResourceOption("class", "../999")).rejects.toThrow(
			"valid resource",
		);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("rejects repeated cursors instead of looping forever", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Response.json([], { headers: { "X-Next-Cursor": "loop" } }),
				),
		);
		await expect(fetchAllCollectionOptions()).rejects.toThrow(
			"repeated next cursor",
		);
	});
});
