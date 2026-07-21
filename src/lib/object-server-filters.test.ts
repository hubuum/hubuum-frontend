import { describe, expect, it } from "vitest";
import {
	appendObjectServerFilters,
	isServerFilterableDataPath,
	parseObjectServerFilters,
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
