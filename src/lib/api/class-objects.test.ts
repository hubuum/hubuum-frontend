import { afterEach, expect, it, vi } from "vitest";
import { fetchObjectsByClass } from "@/lib/api/class-objects";

afterEach(() => vi.unstubAllGlobals());

it("fetches only the requested filtered page and leaves pagination to the caller", async () => {
	const objects = [
		{ id: 1, data: { major: 9 } },
		{ id: 2, data: { major: "9" } },
	];
	const fetch = vi.fn().mockResolvedValue(
		Response.json(objects, {
			headers: {
				"X-Next-Cursor": "next-page",
				"X-Prev-Cursor": "previous-page",
				"X-Total-Count": "45",
			},
		}),
	);
	vi.stubGlobal("fetch", fetch);
	const signal = new AbortController().signal;
	const page = await fetchObjectsByClass(
		12,
		2,
		"current-page",
		"-name",
		[{ field: "description", operator: "equals", value: "RHEL" }],
		signal,
		[{ field: "json_data.major", state: "value", value: "9" }],
	);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(page).toEqual({
		objects,
		nextCursor: "next-page",
		prevCursor: "previous-page",
		totalCount: 45,
	});
	const [path, options] = fetch.mock.calls[0];
	const url = new URL(path, "https://frontend.example");
	expect(url.pathname).toBe("/_hubuum-bff/classes/12/objects");
	expect(Object.fromEntries(url.searchParams)).toEqual({
		limit: "2",
		include: "computed",
		cursor: "current-page",
		sort: "-name",
		description__equals: "RHEL",
		json_data__regex: "major=^9$",
	});
	expect(options).toEqual({ credentials: "include", signal });
});

it("reports request failures and never fetches unfiltered objects as a fallback", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValue(
			Response.json({ message: "Unavailable" }, { status: 503 }),
		);
	vi.stubGlobal("fetch", fetch);
	await expect(fetchObjectsByClass(12, 2)).rejects.toThrow("Unavailable");
	expect(fetch).toHaveBeenCalledTimes(1);
	fetch.mockClear();
	await expect(
		fetchObjectsByClass(12, 2, undefined, undefined, [], undefined, [
			{ field: "json_data.value", state: "value", value: { a: 1 } },
		]),
	).rejects.toThrow("cannot be opened with a server filter");
	expect(fetch).not.toHaveBeenCalled();
});
