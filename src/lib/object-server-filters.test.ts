import { describe, expect, it } from "vitest";
import {
	appendObjectServerFilters,
	getJsonSchemaServerFilterDataType,
	inferObjectServerFilterDataType,
	isServerFilterableDataPath,
	parseObjectServerFilters,
	resolveObjectServerFilterRelativeDates,
	serializeObjectServerFilters,
	toServerFilterDataPath,
} from "@/lib/object-server-filters";

describe("object server filters", () => {
	it("round trips valid base and JSON data filters", () => {
		const filters = [
			{ field: "name" as const, operator: "icontains" as const, value: "srv" },
			{
				field: "json_data" as const,
				operator: "equals" as const,
				value: "10.0.0.1",
				path: ["network", "interfaces", "0", "ipv4"],
			},
		];
		expect(
			parseObjectServerFilters(serializeObjectServerFilters(filters)),
		).toEqual(filters);
	});

	it("compiles filters into the backend query grammar", () => {
		const params = new URLSearchParams();
		appendObjectServerFilters(params, [
			{ field: "description", operator: "icontains", value: "prod" },
			{
				field: "json_data",
				operator: "gte",
				value: "4",
				path: ["metrics", "cpu_count"],
			},
		]);
		expect(params.get("description__icontains")).toBe("prod");
		expect(params.get("json_data__gte")).toBe("metrics,cpu_count=4");
	});

	it("recognizes date and IP data fields from schema formats and values", () => {
		const schema = {
			type: "object",
			properties: {
				lifecycle: {
					type: "object",
					properties: {
						commissioned_at: { type: "string", format: "date-time" },
					},
				},
				interfaces: {
					type: "array",
					items: {
						type: "object",
						properties: {
							address: { type: ["string", "null"], format: "ipv6" },
						},
					},
				},
			},
		};

		expect(
			getJsonSchemaServerFilterDataType(schema, [
				"lifecycle",
				"commissioned_at",
			]),
		).toBe("date");
		expect(
			getJsonSchemaServerFilterDataType(schema, [
				"interfaces",
				"[0]",
				"address",
			]),
		).toBe("ip");
		expect(
			inferObjectServerFilterDataType([
				"2015-03-24T10:52:46Z",
				"2021-07-24",
				null,
			]),
		).toBe("date");
		expect(
			inferObjectServerFilterDataType(["10.0.0.10", "2001:db8::/32"]),
		).toBe("ip");
		expect(inferObjectServerFilterDataType(["2015-03-24", "not a date"])).toBe(
			"unknown",
		);
		expect(inferObjectServerFilterDataType(["2021-02-30T10:00:00Z"])).toBe(
			"string",
		);
	});

	it("compiles date, IP, and null JSON filters", () => {
		const filters = [
			{
				field: "json_data" as const,
				operator: "lt" as const,
				value: "2021-07-24T00:00:00Z",
				path: ["lifecycle", "commissioned_at"],
			},
			{
				field: "json_data" as const,
				operator: "within_network" as const,
				value: "10.0.0.0/24",
				path: ["network", "address"],
			},
			{
				field: "json_data" as const,
				operator: "contains_network" as const,
				value: "10.0.0.0/25",
				path: ["network", "address"],
			},
			{
				field: "json_data" as const,
				operator: "contains_ip" as const,
				value: "10.0.0.10",
				path: ["network", "address"],
			},
			{
				field: "json_data" as const,
				operator: "overlaps_network" as const,
				value: "10.0.0.64/26",
				path: ["network", "address"],
			},
			{
				field: "json_data" as const,
				operator: "inet_equals" as const,
				value: "10.0.0.10/32",
				path: ["network", "address"],
			},
			{
				field: "json_data" as const,
				operator: "not_is_null" as const,
				value: "",
				path: ["network", "address"],
			},
		];
		expect(
			parseObjectServerFilters(serializeObjectServerFilters(filters)),
		).toEqual(filters);

		const params = new URLSearchParams();
		appendObjectServerFilters(params, filters);
		expect(params.get("json_data__lt")).toBe(
			"lifecycle,commissioned_at=2021-07-24T00:00:00Z",
		);
		expect(params.get("json_data__within_network")).toBe(
			"network,address=10.0.0.0/24",
		);
		expect(params.get("json_data__contains_network")).toBe(
			"network,address=10.0.0.0/25",
		);
		expect(params.get("json_data__contains_ip")).toBe(
			"network,address=10.0.0.10",
		);
		expect(params.get("json_data__overlaps_network")).toBe(
			"network,address=10.0.0.64/26",
		);
		expect(params.get("json_data__inet_equals")).toBe(
			"network,address=10.0.0.10/32",
		);
		expect(params.get("json_data__not_is_null")).toBe("network,address");
	});

	it("resolves relative dates to fixed RFC3339 values at submission time", () => {
		const now = new Date("2024-02-29T12:34:56.789Z");

		expect(resolveObjectServerFilterRelativeDates("-4y", now)).toBe(
			"2020-02-29T12:34:56.789Z",
		);
		expect(resolveObjectServerFilterRelativeDates("+1y", now)).toBe(
			"2025-02-28T12:34:56.789Z",
		);
		expect(resolveObjectServerFilterRelativeDates("-1mo", now)).toBe(
			"2024-01-29T12:34:56.789Z",
		);
		expect(resolveObjectServerFilterRelativeDates("-2w,now", now)).toBe(
			"2024-02-15T12:34:56.789Z,2024-02-29T12:34:56.789Z",
		);
		expect(resolveObjectServerFilterRelativeDates("2021-07-24", now)).toBe(
			"2021-07-24",
		);
		expect(resolveObjectServerFilterRelativeDates("four years ago", now)).toBe(
			"four years ago",
		);
	});

	it("round trips and compiles typed computed filters", () => {
		const filters = [
			{
				field: "computed" as const,
				computedScope: "shared" as const,
				computedKey: "lifecycle",
				computedResultType: "string" as const,
				operator: "not_in" as const,
				value: "retired,offline",
			},
			{
				field: "computed" as const,
				computedScope: "personal" as const,
				computedKey: "priority",
				computedResultType: "integer" as const,
				operator: "between" as const,
				value: "10,20",
			},
		];
		expect(
			parseObjectServerFilters(serializeObjectServerFilters(filters)),
		).toEqual(filters);

		const params = new URLSearchParams();
		appendObjectServerFilters(params, filters);
		expect(params.get("computed.shared.lifecycle__not_in")).toBe(
			"retired,offline",
		);
		expect(params.get("computed.personal.priority__between")).toBe("10,20");
	});

	it("enforces typed computed values and the two-filter server bound", () => {
		const serialized = JSON.stringify([
			...Array.from({ length: 3 }, (_, index) => ({
				field: "computed",
				computedScope: "shared",
				computedKey: `count_${index}`,
				computedResultType: "integer",
				operator: "gte",
				value: String(index),
			})),
			{
				field: "computed",
				computedScope: "shared",
				computedKey: "broken",
				computedResultType: "object",
				operator: "equals",
				value: "not-json",
			},
		]);
		expect(parseObjectServerFilters(serialized)).toHaveLength(2);
	});

	it("drops unsafe paths, invalid values, and unsupported operators", () => {
		expect(isServerFilterableDataPath(["network", "ipv4"])).toBe(true);
		expect(isServerFilterableDataPath(["network-interface", "ipv4"])).toBe(
			false,
		);
		expect(
			toServerFilterDataPath(["network", "interfaces", "[0]", "ipv4"]),
		).toEqual(["network", "interfaces", "0", "ipv4"]);
		expect(toServerFilterDataPath(["bad-key", "[0]"])).toBe(null);
		expect(
			parseObjectServerFilters(
				JSON.stringify([
					{ field: "id", operator: "icontains", value: "1" },
					{
						field: "json_data",
						operator: "equals",
						value: "x",
						path: ["bad-key"],
					},
				]),
			),
		).toEqual([]);
	});
});
