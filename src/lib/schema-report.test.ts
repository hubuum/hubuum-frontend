import { describe, expect, it } from "vitest";
import type {
	SchemaImpactFindingResponse,
	SchemaImpactResponse,
	SchemaIssue,
} from "@/lib/api/generated/models";
import {
	consolidateSchemaIssues,
	schemaActualDescription,
	schemaFailureCoverage,
	schemaObjectUrlTemplate,
} from "@/lib/schema-report";

describe("consolidated schema errors", () => {
	const issue: SchemaIssue = {
		reason: { keyword: "type", schema_path: "/properties/address/type" },
		message: "Expected a string.",
		instance_path: "/address",
		expected: { status: "available", value: "string" },
		actual: "number",
		alternative: false,
		omissions: ["actual_value_redacted"],
	};
	function finding(id: number, issues = [issue]): SchemaImpactFindingResponse {
		return {
			object_id: id,
			reason: issue.reason,
			snapshot: {
				object_revision: id,
				inspected_at: `2026-09-15T00:00:${String(id).padStart(2, "0")}Z`,
				diagnostics: { issues, truncated: id === 1 },
			},
		};
	}
	it("shows the same error once while retaining every object snapshot", () => {
		const findings = [finding(1), finding(2)];
		const groups = consolidateSchemaIssues(findings);
		expect(groups).toHaveLength(1);
		expect(groups[0].objects.map((member) => member.finding)).toEqual(findings);
		expect(groups[0].objects[0].finding.snapshot?.diagnostics.truncated).toBe(
			true,
		);
		expect(groups[0].objects[1].finding.snapshot?.object_revision).toBe(2);
	});
	it("counts affected objects once while retaining repeated redacted occurrences", () => {
		const groups = consolidateSchemaIssues([
			finding(1, [issue, issue]),
			finding(2),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].objects).toHaveLength(2);
		expect(groups[0].occurrences).toBe(3);
		expect(groups[0].objects.map((object) => object.occurrences)).toEqual([
			2, 1,
		]);
	});
	it("allows one object to belong to several error groups", () => {
		const groups = consolidateSchemaIssues([
			finding(1, [issue, { ...issue, instance_path: "/other" }]),
			finding(2),
		]);
		expect(
			groups.map((group) =>
				group.objects.map((member) => member.finding.object_id),
			),
		).toEqual([[1, 2], [1]]);
	});
	it.each<Partial<SchemaIssue>>([
		{ instance_path: "/interfaces/3/address" },
		{ instance_path: "" },
		{ instance_path: null },
		{ expected: { status: "available", value: null } },
		{ expected: { status: "omitted" } },
		{ actual: { string: { characters: 4 } } },
		{ alternative: true },
		{ omissions: [] },
		{ reason: { ...issue.reason, schema_path: "/another/type" } },
		{ message: "Another explanation." },
	])("keeps different retained details separate: %j", (difference) => {
		expect(
			consolidateSchemaIssues([
				finding(1),
				finding(2, [{ ...issue, ...difference }]),
			]),
		).toHaveLength(2);
	});
	it("ignores JSON object key order without changing array order or input data", () => {
		const first = {
			...issue,
			expected: { status: "available" as const, value: { a: 1, b: 2 } },
		};
		const second = {
			...issue,
			expected: { status: "available" as const, value: { b: 2, a: 1 } },
		};
		const findings = [finding(1, [first]), finding(2, [second])];
		const before = structuredClone(findings);
		expect(consolidateSchemaIssues(findings)).toHaveLength(1);
		expect(findings).toEqual(before);
	});
	it("keeps legacy first failures separate from detailed issues and empty snapshots", () => {
		const legacy = { ...finding(1), snapshot: null };
		const groups = consolidateSchemaIssues([
			legacy,
			{ ...legacy, object_id: 2 },
			finding(3),
			finding(4, []),
		]);
		expect(groups).toHaveLength(3);
		expect(groups[0].objects.map((member) => member.finding.object_id)).toEqual(
			[1, 2],
		);
	});
	it("handles an empty report", () =>
		expect(consolidateSchemaIssues([])).toEqual([]));
});

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
