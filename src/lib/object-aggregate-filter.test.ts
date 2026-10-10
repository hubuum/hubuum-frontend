import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ObjectAggregateCount } from "@/components/object-aggregate-count";
import {
	buildObjectAggregateObjectsHref,
	getObjectAggregateMemberFilters,
} from "@/lib/object-aggregate-filter";
import {
	appendObjectServerFilters,
	OBJECT_SERVER_FILTERS_QUERY_KEY,
	type ObjectServerFilter,
	parseObjectServerFilters,
} from "@/lib/object-server-filters";

const sourceFilter: ObjectServerFilter = {
	field: "description",
	operator: "equals",
	value: "RHEL",
};
const computedFilter: ObjectServerFilter = {
	field: "computed",
	operator: "equals",
	value: "true",
	computedScope: "shared",
	computedKey: "active",
	computedResultType: "boolean",
};

describe("aggregate server filters", () => {
	it("turns nested group dimensions into ordinary filters and retains source predicates", () => {
		const filters = getObjectAggregateMemberFilters(
			[
				{
					field: "json_data.facts,operating_system,distribution",
					state: "value",
					value: "RedHat",
				},
				{
					field: "json_data.facts,operating_system,major_version",
					state: "value",
					value: "9",
				},
				{
					field: "json_data.facts,operating_system,version",
					state: "value",
					value: "9.8",
				},
			],
			[sourceFilter],
		);
		const url = new URL(
			buildObjectAggregateObjectsHref(12, filters, 50),
			"https://frontend.example",
		);
		expect(url.pathname).toBe("/objects");
		expect([...url.searchParams.keys()]).toEqual([
			"classId",
			"limit",
			"objectFilters",
		]);
		expect(
			parseObjectServerFilters(
				url.searchParams.get(OBJECT_SERVER_FILTERS_QUERY_KEY),
			),
		).toEqual(filters);
		const params = new URLSearchParams();
		appendObjectServerFilters(params, filters);
		expect([...params]).toEqual([
			["description__equals", "RHEL"],
			["json_data__regex", "facts,operating_system,distribution=^RedHat$"],
			["json_data__regex", "facts,operating_system,major_version=^9$"],
			["json_data__regex", "facts,operating_system,version=^9\\.8$"],
		]);
	});

	it.each(["", false, " a.+*?$^{}()|[]\\=,b ", "2026-01-01", "9.8"])(
		"matches JSON text literally: %s",
		(value) => {
			const [filter] = getObjectAggregateMemberFilters([
				{ field: "json_data.version", state: "value", value },
			]);
			expect(new RegExp(filter.value).test(String(value))).toBe(true);
			expect(new RegExp(filter.value).test(`${value}extra`)).toBe(false);
		},
	);

	it.each([
		[9, ["9", "9.0", "9.000"], ["19", "9.1", "9.01"]],
		[
			0.0000001,
			["0.0000001", "0.000000100", "1e-7"],
			["0.000001", "0.00000011"],
		],
		[-9.2, ["-9.2", "-9.200"], ["9.2", "-9.201"]],
		[
			1e21,
			["1000000000000000000000", "1000000000000000000000.00", "1e+21"],
			["1000000000000000000001"],
		],
		[0, ["0", "0.000"], ["0.1", "10"]],
	] as const)(
		"matches equivalent JSONB numeric representations for %s",
		(value, matches, misses) => {
			const [filter] = getObjectAggregateMemberFilters([
				{ field: "json_data.number", state: "value", value },
			]);
			const pattern = new RegExp(filter.value);
			for (const match of matches) expect(pattern.test(match)).toBe(true);
			for (const miss of misses) expect(pattern.test(miss)).toBe(false);
		},
	);

	it.each(["name", "description", "computed.shared.version"])(
		"preserves empty strings and whitespace for %s",
		(field) => {
			for (const value of ["", " ", " a "]) {
				const filters = getObjectAggregateMemberFilters([
					{ field, state: "value", value },
				]);
				const params = new URLSearchParams();
				appendObjectServerFilters(params, filters);
				expect(params.get(`${field}__regex`)).toBe(`^${value}$`);
				expect(parseObjectServerFilters(JSON.stringify(filters))).toEqual(
					filters,
				);
			}
		},
	);

	it("preserves null semantics, typed computed values and timestamp precision", () => {
		const filters = getObjectAggregateMemberFilters([
			{ field: "json_data.optional", state: "null" },
			{ field: "json_data.absent", state: "missing" },
			{ field: "computed.personal.optional", state: "unavailable" },
			{ field: "computed.shared.tags", state: "value", value: ["api"] },
			{
				field: "created_at",
				state: "value",
				value: "2026-01-01T12:00:00.123456",
			},
		]);
		const params = new URLSearchParams();
		appendObjectServerFilters(params, filters);
		expect(params.getAll("json_data__is_null")).toEqual(["optional", "absent"]);
		expect(params.get("computed.personal.optional__is_null")).toBe("true");
		expect(params.get("computed.shared.tags__equals")).toBe('["api"]');
		expect(params.get("created_at__equals")).toBe(
			"2026-01-01T12:00:00.123456Z",
		);
		expect(parseObjectServerFilters(JSON.stringify(filters))).toEqual(filters);
	});

	it("rejects the combined computed budget and total filter limit without dropping predicates", () => {
		const dimension = {
			field: "computed.shared.version",
			state: "value" as const,
			value: "9",
		};
		expect(
			getObjectAggregateMemberFilters([dimension], [computedFilter]),
		).toHaveLength(2);
		expect(() =>
			getObjectAggregateMemberFilters(
				[dimension],
				[computedFilter, { ...computedFilter, computedKey: "enabled" }],
			),
		).toThrow("more than two computed filters");
		expect(() =>
			getObjectAggregateMemberFilters([
				dimension,
				{ ...dimension, field: "computed.shared.major" },
				{ ...dimension, field: "computed.shared.minor" },
			]),
		).toThrow("more than two computed filters");
		expect(() =>
			getObjectAggregateMemberFilters(
				[{ field: "name", state: "value", value: "a" }],
				Array.from({ length: 8 }, (_, index) => ({
					...sourceFilter,
					value: `RHEL ${index}`,
				})),
			),
		).toThrow("more than 8 server filters");
	});

	it("reuses identical predicates without replacing other conditions on that field", () => {
		const source: ObjectServerFilter = {
			field: "json_data",
			path: ["version"],
			operator: "regex",
			value: "^9.*$",
		};
		const dimension = {
			field: "json_data.version",
			state: "value" as const,
			value: "9",
		};
		const filters = getObjectAggregateMemberFilters([dimension], [source]);
		expect(filters).toHaveLength(2);
		expect(filters[0]).toEqual(source);
		expect(getObjectAggregateMemberFilters([dimension], filters)).toEqual(
			filters,
		);
	});

	it("refuses unrepresentable group predicates instead of silently losing them", () => {
		for (const value of [{ a: 1 }, [1]]) {
			expect(() =>
				getObjectAggregateMemberFilters([
					{ field: "json_data.value", state: "value", value },
				]),
			).toThrow("cannot be opened with a server filter");
		}
		expect(() =>
			getObjectAggregateMemberFilters([
				{ field: "json_data.value", state: "value", value: "x".repeat(501) },
			]),
		).toThrow("cannot be represented");
	});
});

it("disables drill-down before offering a request over the combined computed limit", () => {
	const markup = renderToStaticMarkup(
		createElement(ObjectAggregateCount, {
			request: {
				classId: 12,
				limit: 50,
				filters: [
					computedFilter,
					{ ...computedFilter, computedKey: "enabled" },
				],
			},
			row: {
				object_count: 5,
				dimensions: [
					{ field: "computed.shared.version", state: "value", value: "9" },
				],
			},
			fieldLabels: ["Version"],
			collectionNames: new Map(),
		}),
	);
	expect(markup).toContain('disabled=""');
	expect(markup).toContain("more than two computed filters");
	expect(markup).not.toContain("href=");
});
