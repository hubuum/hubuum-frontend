import { describe, expect, it } from "vitest";

import {
	arrayItemCount,
	fieldForJsonPointer,
	jsonPointerFromFieldPath,
	operationCompatibility,
	readJsonPointer,
	recommendedResultType,
	slugifyComputedFieldKey,
	sortDiscoveredJsonFields,
} from "@/lib/computed-field-editor";
import type { DiscoveredJsonField } from "@/lib/json-field-discovery";

const numericField: DiscoveredJsonField = {
	label: "prices[]",
	observedIn: 0,
	path: ["prices", "[#]"],
	source: "schema",
	templateExpression: "item.data.prices[0]",
	types: ["number"],
};

describe("computed field editor helpers", () => {
	it("turns discovered paths into escaped JSON Pointers", () => {
		expect(jsonPointerFromFieldPath(["inventory", "serial/number"])).toBe(
			"/inventory/serial~1number",
		);
		expect(jsonPointerFromFieldPath(["values", "[2]"])).toBe("/values/2");
	});

	it("requires explicit indexes for generic array items", () => {
		expect(arrayItemCount(numericField.path)).toBe(1);
		expect(jsonPointerFromFieldPath(numericField.path)).toBeNull();
		expect(jsonPointerFromFieldPath(numericField.path, ["3"])).toBe(
			"/prices/3",
		);
	});

	it("matches materialized array pointers back to their discovered field", () => {
		expect(fieldForJsonPointer([numericField], "/prices/9")).toBe(numericField);
	});

	it("naturally sorts discovered fields without changing the input", () => {
		const fields = ["servers.item10", "Zone", "servers.item2", "alpha"].map(
			(label, index): DiscoveredJsonField => ({
				...numericField,
				label,
				path: [String(index)],
			}),
		);

		expect(
			sortDiscoveredJsonFields(fields).map((field) => field.label),
		).toEqual(["alpha", "servers.item2", "servers.item10", "Zone"]);
		expect(fields.map((field) => field.label)).toEqual([
			"servers.item10",
			"Zone",
			"servers.item2",
			"alpha",
		]);
	});

	it("filters numeric operations using discovered types", () => {
		expect(
			operationCompatibility("sum", ["/prices/0"], [numericField]),
		).toEqual({ compatible: true, reason: null });
		expect(
			operationCompatibility(
				"sum",
				["/name"],
				[{ ...numericField, types: ["string"] }],
			),
		).toMatchObject({ compatible: false });
	});

	it("infers constrained and discovered result types", () => {
		expect(recommendedResultType("count_present", [], "string")).toBe(
			"integer",
		);
		expect(
			recommendedResultType("first_non_null", [numericField], "string"),
		).toBe("number");
	});

	it("generates keys and resolves escaped pointers", () => {
		expect(slugifyComputedFieldKey("42° Total Cost")).toBe(
			"field_42_total_cost",
		);
		expect(readJsonPointer({ "a/b": [{ value: 7 }] }, "/a~1b/0/value")).toBe(7);
	});
});
