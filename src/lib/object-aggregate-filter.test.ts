import { describe, expect, it } from "vitest";
import {
	appendObjectAggregateFilters,
	buildObjectAggregateObjectsHref,
	OBJECT_AGGREGATE_FILTER_QUERY_KEY,
	parseObjectAggregateFilter,
} from "@/lib/object-aggregate-filter";
import {
	OBJECT_SERVER_FILTERS_QUERY_KEY,
	parseObjectServerFilters,
} from "@/lib/object-server-filters";

describe("aggregate server filters", () => {
	it("filters every dimension and preserves existing predicates", () => {
		const params = new URLSearchParams({ description__equals: "RHEL" });
		appendObjectAggregateFilters(params, [
			{ field: "json_data.os_major", state: "value", value: 9 },
			{ field: "json_data.os_minor", state: "value", value: "9.2" },
			{ field: "collection_id", state: "value", value: 3 },
		]);
		expect([...params]).toEqual([
			["description__equals", "RHEL"],
			["json_data__regex", "os_major=^9$"],
			["json_data__regex", "os_minor=^9\\.2$"],
			["collection_id__equals", "3"],
		]);
		for (const value of [9, "9"]) {
			const params = new URLSearchParams();
			appendObjectAggregateFilters(params, [
				{ field: "json_data.os_major", state: "value", value },
			]);
			expect(params.get("json_data__regex")).toBe("os_major=^9$");
		}
	});
	it("escapes JSON text literally, including decimals, empty strings and regex syntax", () => {
		for (const value of [
			"",
			false,
			9.2,
			" a.+*?$^{}()|[]\\=,b ",
			"2026-01-01",
		]) {
			const params = new URLSearchParams();
			appendObjectAggregateFilters(params, [
				{ field: "json_data.facts,version", state: "value", value },
			]);
			const pattern =
				params.get("json_data__regex")?.slice("facts,version=".length) ?? "";
			expect(new RegExp(pattern).test(String(value))).toBe(true);
			expect(new RegExp(pattern).test(`${value}extra`)).toBe(false);
		}
	});
	it("uses server null semantics and computed equality without dropping source filters", () => {
		const params = new URLSearchParams({
			"computed.shared.active__equals": "true",
		});
		appendObjectAggregateFilters(params, [
			{ field: "json_data.optional", state: "null" },
			{ field: "json_data.absent", state: "missing" },
			{ field: "computed.personal.optional", state: "unavailable" },
		]);
		expect(params.getAll("json_data__is_null")).toEqual(["optional", "absent"]);
		expect(params.get("computed.personal.optional__is_null")).toBe("true");
		expect(params.get("computed.shared.active__equals")).toBe("true");
		appendObjectAggregateFilters(params, [
			{ field: "computed.shared.version", state: "value", value: "9.2" },
			{ field: "computed.shared.tags", state: "value", value: ["api"] },
			{ field: "description", state: "value", value: "" },
		]);
		expect(params.get("computed.shared.version__equals")).toBe("9.2");
		expect(params.get("computed.shared.tags__equals")).toBe('["api"]');
		expect(params.get("description__equals")).toBe("");
	});
	it("preserves timestamp precision and does not scan unsupported JSON structures", () => {
		const params = new URLSearchParams();
		appendObjectAggregateFilters(params, [
			{
				field: "created_at",
				state: "value",
				value: "2026-01-01T12:00:00.123456",
			},
		]);
		expect(params.get("created_at__equals")).toBe(
			"2026-01-01T12:00:00.123456Z",
		);
		for (const value of [{ a: 1 }, [1]]) {
			expect(() =>
				appendObjectAggregateFilters(params, [
					{ field: "json_data.value", state: "value", value },
				]),
			).toThrow("cannot be opened with a server filter");
		}
	});
});

describe("aggregate object table links", () => {
	it("round trips typed dimensions and source filters without carrying old cursors", () => {
		const dimensions = [
			{ field: "json_data.major", state: "value" as const, value: "9&x=#" },
			{ field: "json_data.minor", state: "missing" as const },
		];
		const filters = [
			{
				field: "description" as const,
				operator: "equals" as const,
				value: "RHEL",
			},
		];
		const url = new URL(
			buildObjectAggregateObjectsHref(12, dimensions, filters, 50),
			"https://frontend.example",
		);
		expect(url.pathname).toBe("/objects");
		expect(url.searchParams.get("classId")).toBe("12");
		expect(url.searchParams.get("limit")).toBe("50");
		expect(url.searchParams.has("cursor")).toBe(false);
		expect(
			parseObjectAggregateFilter(
				url.searchParams.get(OBJECT_AGGREGATE_FILTER_QUERY_KEY) ?? "",
			),
		).toEqual(dimensions);
		expect(
			parseObjectServerFilters(
				url.searchParams.get(OBJECT_SERVER_FILTERS_QUERY_KEY),
			),
		).toEqual(filters);
	});
	it("keeps aggregation view settings on drill-down links without copying object cursors", () => {
		const view = new URLSearchParams(
			"groupBy=object%3Aname&aggregate=sum%3Ajson_data.cost&groupSort=value-asc&aggregateView=tree&aggregateCursor=page-2&cursor=old",
		);
		const url = new URL(
			buildObjectAggregateObjectsHref(12, [], [], 50, view),
			"https://frontend.example",
		);
		expect(url.searchParams.getAll("groupBy")).toEqual(["object:name"]);
		expect(url.searchParams.getAll("aggregate")).toEqual([
			"sum:json_data.cost",
		]);
		expect(url.searchParams.get("aggregateCursor")).toBe("page-2");
		expect(url.searchParams.get("cursor")).toBeNull();
	});
	it("supports global aggregates and empty, boolean, numeric, structured and unavailable values", () => {
		expect(parseObjectAggregateFilter("[]")).toEqual([]);
		for (const value of ["", false, 0, { a: [1, "2"] }]) {
			const dimensions = [{ field: "json_data.value", state: "value", value }];
			expect(parseObjectAggregateFilter(JSON.stringify(dimensions))).toEqual(
				dimensions,
			);
		}
		const unavailable = [
			{ field: "computed.shared.version", state: "unavailable" },
		];
		expect(parseObjectAggregateFilter(JSON.stringify(unavailable))).toEqual(
			unavailable,
		);
	});
	it.each([
		"",
		"null",
		"{}",
		"[{}, {}, {}, {}]",
		'[{"field":"json_data.x","state":"value"}]',
		'[{"field":"name","state":"missing"}]',
		'[{"field":"json_data.x","state":"unavailable"}]',
		'[{"field":"unknown","state":"null"}]',
		'[{"field":"json_data.x!","state":"null"}]',
	])(
		"rejects invalid links rather than dropping their filter: %s",
		(serialized) => {
			expect(() => parseObjectAggregateFilter(serialized)).toThrow();
		},
	);
});
