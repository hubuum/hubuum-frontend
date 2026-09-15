import { describe, expect, it } from "vitest";
import type { SchemaImpactResponse } from "@/lib/api/generated/models";
import {
	schemaActualDescription,
	schemaFailureCoverage,
	schemaObjectUrlTemplate,
} from "@/lib/schema-report";

function impact(
	failures: SchemaImpactResponse["failures"],
	ungrouped = 0,
): SchemaImpactResponse {
	return {
		baseline: { class_id: 10, revision: 1 },
		counts: {
			newly_invalid: 0,
			still_invalid: 0,
			newly_valid: 0,
			still_valid: 0,
			newly_required_valid: 0,
			no_longer_required: 0,
			unchanged_not_required: 0,
			uninspectable: 0,
		},
		failures,
		ungrouped_failures: ungrouped,
	};
}

describe("schema failure coverage", () => {
	it("uses the frontend origin, class route and deployment prefix for downloaded object links", () => {
		expect(
			schemaObjectUrlTemplate(
				10,
				"https://inventory.example/inventory/classes/10/schema?task=20&step=impact",
			),
		).toBe("https://inventory.example/inventory/objects/10/{object_id}");
		expect(
			schemaObjectUrlTemplate(10, "http://localhost:3001/classes/10/schema/"),
		).toBe("http://localhost:3001/objects/10/{object_id}");
	});
	it("describes the saved type and size without implying scalar values were retained", () => {
		expect(schemaActualDescription("null")).toBe("null");
		expect(schemaActualDescription("number")).toBe("number");
		expect(schemaActualDescription({ string: { characters: 5 } })).toBe(
			"string (5 characters)",
		);
		expect(schemaActualDescription({ array: { items: 4 } })).toBe(
			"array (4 items)",
		);
		expect(schemaActualDescription({ object: { properties: 2 } })).toBe(
			"object (2 properties)",
		);
	});
	it("counts complete lists beyond both legacy limits", () => {
		const groups = Array.from({ length: 25 }, (_, group) => ({
			reason: { keyword: "required", missing_property: `field_${group}` },
			objects: 7,
			samples: Array.from({ length: 7 }, (_, object) => group * 7 + object),
		}));
		expect(schemaFailureCoverage(impact(groups))).toEqual({
			available: 175,
			omitted: 0,
		});
	});
	it("detects sampled IDs even when every failure group was retained", () => {
		expect(
			schemaFailureCoverage(
				impact([
					{
						reason: { keyword: "type" },
						objects: 43,
						samples: [1, 2, 3, 4, 5],
					},
				]),
			),
		).toEqual({ available: 5, omitted: 38 });
	});
	it("combines legacy sampled groups, complete groups and ungrouped failures", () => {
		expect(
			schemaFailureCoverage(
				impact(
					[
						{
							reason: { keyword: "type" },
							objects: 10,
							samples: [1, 2, 3, 4, 5],
						},
						{ reason: { keyword: "required" }, objects: 2, samples: [6, 7] },
					],
					3,
				),
			),
		).toEqual({ available: 7, omitted: 8 });
	});
	it("detects omitted groups without any retained IDs", () => {
		expect(schemaFailureCoverage(impact([], 30))).toEqual({
			available: 0,
			omitted: 30,
		});
	});
	it("does not invent missing IDs for valid or uninspectable objects", () => {
		const report = impact([]);
		report.counts.newly_required_valid = 500;
		report.counts.uninspectable = 2;
		expect(schemaFailureCoverage(report)).toEqual({ available: 0, omitted: 0 });
	});
});
