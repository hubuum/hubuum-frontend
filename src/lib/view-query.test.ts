import { afterEach, expect, it, vi } from "vitest";
import { patchViewQuery, updateViewQuery } from "@/lib/view-query";

afterEach(() => vi.unstubAllGlobals());

it("updates only named keys and preserves repeated values, encoding and anchors", () => {
	const url = new URL(
		"https://frontend.example/objects?classId=12&groupBy=old&cursor=old#results",
	);
	const result = patchViewQuery(url, {
		groupBy: ['data:["os"]', "object:name"],
		cursor: null,
		search: "a&b=#",
	});
	const parsed = new URL(result, url);
	expect(parsed.pathname).toBe("/objects");
	expect(parsed.searchParams.get("classId")).toBe("12");
	expect(parsed.searchParams.getAll("groupBy")).toEqual([
		'data:["os"]',
		"object:name",
	]);
	expect(parsed.searchParams.get("search")).toBe("a&b=#");
	expect(parsed.searchParams.has("cursor")).toBe(false);
	expect(parsed.hash).toBe("#results");
});

it("merges rapid edits using the latest URL and uses the requested history behavior", () => {
	const location = { href: "https://frontend.example/exports" };
	const change = (_state: unknown, _title: string, href: string) => {
		location.href = new URL(href, location.href).href;
	};
	const history = { replaceState: vi.fn(change), pushState: vi.fn(change) };
	vi.stubGlobal("window", { location, history });
	updateViewQuery({ view: "templates" });
	updateViewQuery({ templateSearch: "rhel" });
	updateViewQuery({ templateSearch: "rhel" });
	updateViewQuery({ cursor: "next" }, "push");
	expect(history.replaceState).toHaveBeenCalledTimes(2);
	expect(history.pushState).toHaveBeenCalledOnce();
	expect(location.href).toBe(
		"https://frontend.example/exports?view=templates&templateSearch=rhel&cursor=next",
	);
});
