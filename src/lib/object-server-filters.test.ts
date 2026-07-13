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
		expect(parseObjectServerFilters(serializeObjectServerFilters(filters))).toEqual(
			filters,
		);
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
