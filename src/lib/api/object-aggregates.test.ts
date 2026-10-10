import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildObjectAggregateSearchParams,
	fetchAllObjectAggregates,
} from "@/lib/api/object-aggregates";

afterEach(() => vi.unstubAllGlobals());

describe("object aggregate requests", () => {
	it("preserves ordered repeated dimensions and source filters", () => {
		const params = buildObjectAggregateSearchParams({
			groupBy: [
				"json_data.location,country",
				"json_data.os_minor",
				"computed.shared.lifecycle",
			],
			sort: "object_count.desc",
			limit: 50,
			cursor: "next-page",
			filters: [
				{
					field: "computed",
					computedScope: "shared",
					computedKey: "lifecycle",
					computedResultType: "string",
					operator: "equals",
					value: "active",
				},
			],
		});

		expect(params.getAll("group_by")).toEqual([
			"json_data.location,country",
			"json_data.os_minor",
			"computed.shared.lifecycle",
		]);
		expect(params.get("computed.shared.lifecycle__equals")).toBe("active");
		expect(params.get("sort")).toBe("object_count.desc");
		expect(params.get("cursor")).toBe("next-page");
	});

	it("preserves ordered numeric measures", () => {
		const params = buildObjectAggregateSearchParams({
			groupBy: ["collection_id"],
			measures: [
				{ operation: "sum", field: "json_data.cost" },
				{ operation: "average", field: "computed.shared.utilization" },
			],
			sort: "object_count.desc",
			limit: 50,
		});

		expect(params.getAll("aggregate")).toEqual([
			"sum:json_data.cost",
			"average:computed.shared.utilization",
		]);
	});

	it("supports a global measure without a group dimension", () => {
		const params = buildObjectAggregateSearchParams({
			groupBy: [],
			measures: [{ operation: "max", field: "json_data.capacity" }],
			sort: "object_count.desc",
			limit: 50,
		});

		expect(params.has("group_by")).toBe(false);
		expect(params.get("aggregate")).toBe("max:json_data.capacity");
	});

	it("rejects a request without a dimension or measure", () => {
		expect(() =>
			buildObjectAggregateSearchParams({
				groupBy: [],
				sort: "object_count.desc",
				limit: 50,
			}),
		).toThrowError("Choose at least one aggregate dimension or measure.");
	});
});

describe("aggregate tree level loading", () => {
	const request = {
		classId: 12,
		groupBy: ["json_data.major", "json_data.minor"],
		sort: "object_count.desc" as const,
		limit: 50,
	};
	const row = (major: number, minor: number, count: number) => ({
		dimensions: [
			{ field: "json_data.major", state: "value", value: major },
			{ field: "json_data.minor", state: "value", value: minor },
		],
		object_count: count,
	});

	it.each(["dimensions.asc", "dimensions.desc"] as const)(
		"naturally sorts %s across all server pages",
		async (sort) => {
			const rows = ["10", "8", "9"].map((value) => ({
				dimensions: [{ field: "json_data.major", state: "value", value }],
				object_count: 5,
			}));
			const fetch = vi
				.fn()
				.mockResolvedValueOnce(
					Response.json(rows.slice(0, 2), {
						headers: { "X-Next-Cursor": "last" },
					}),
				)
				.mockResolvedValueOnce(Response.json(rows.slice(2)));
			vi.stubGlobal("fetch", fetch);
			expect(
				(await fetchAllObjectAggregates({ ...request, sort })).map(
					(row) => row.dimensions[0].value,
				),
			).toEqual(
				sort === "dimensions.asc" ? ["8", "9", "10"] : ["10", "9", "8"],
			);
			expect(fetch).toHaveBeenCalledTimes(2);
		},
	);

	it("follows all cursors across parents without changing the query or server subtotals", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json([row(9, 1, 40)], {
					headers: { "X-Next-Cursor": "page/2" },
				}),
			)
			.mockResolvedValueOnce(Response.json([row(10, 1, 80), row(9, 2, 35)]));
		vi.stubGlobal("fetch", fetch);
		const progress = vi.fn();
		const signal = new AbortController().signal;
		const rows = await fetchAllObjectAggregates(
			{
				...request,
				measures: [{ operation: "average", field: "json_data.cost" }],
				filters: [{ field: "description", operator: "equals", value: "RHEL" }],
			},
			signal,
			progress,
		);
		expect(rows.map((row) => row.object_count)).toEqual([40, 80, 35]);
		expect(progress.mock.calls).toEqual([[1], [3]]);
		const first = new URL(fetch.mock.calls[0][0], "http://localhost")
			.searchParams;
		const second = new URL(fetch.mock.calls[1][0], "http://localhost")
			.searchParams;
		expect(first.get("include_total")).toBe("false");
		expect(second.get("cursor")).toBe("page/2");
		second.delete("cursor");
		expect(second.toString()).toBe(first.toString());
		expect(first.get("description__equals")).toBe("RHEL");
		expect(first.getAll("aggregate")).toEqual(["average:json_data.cost"]);
		expect(fetch.mock.calls[1][1]).toEqual({ credentials: "include", signal });
	});

	it("rejects cursor cycles instead of returning an incomplete level", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					Response.json([row(9, 1, 40)], {
						headers: { "X-Next-Cursor": "repeat" },
					}),
				)
				.mockResolvedValueOnce(
					Response.json([], { headers: { "X-Next-Cursor": "repeat" } }),
				),
		);
		await expect(fetchAllObjectAggregates(request)).rejects.toThrow(
			"repeated an aggregate cursor",
		);
	});

	it("discards partial results when a later page fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					Response.json([row(9, 1, 40)], {
						headers: { "X-Next-Cursor": "page2" },
					}),
				)
				.mockResolvedValueOnce(
					Response.json({ message: "Unavailable" }, { status: 503 }),
				),
		);
		await expect(fetchAllObjectAggregates(request)).rejects.toThrow();
	});

	it("stops fetching pages when the view is cancelled", async () => {
		const abort = new AbortController();
		const fetch = vi.fn().mockResolvedValue(
			Response.json([row(9, 1, 40)], {
				headers: { "X-Next-Cursor": "page2" },
			}),
		);
		vi.stubGlobal("fetch", fetch);
		await expect(
			fetchAllObjectAggregates(request, abort.signal, () => abort.abort()),
		).rejects.toThrow();
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
