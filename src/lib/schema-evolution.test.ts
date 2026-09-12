import { describe, expect, it } from "vitest";
import type {
	ClassSchemaResponse,
	SchemaRevisionResponse,
	SchemaWorkResponse,
} from "@/lib/api/generated/models";
import {
	parseSchemaDraft,
	positiveSchemaId,
	schemaActivationBlock,
} from "@/lib/schema-evolution";

const active: SchemaRevisionResponse = {
	class_id: 10,
	revision: 1,
	status: "active",
	validate_schema: false,
	created_at: "2026-09-12T10:00:00Z",
};
const candidate: SchemaRevisionResponse = {
	...active,
	revision: 2,
	status: "staged",
	validate_schema: true,
	json_schema: { type: "object" },
};
const summary: ClassSchemaResponse = {
	active,
	object_epoch: 3,
	counts: { valid: 0, invalid: 0, pending: 0, not_required: 2 },
};
const work: SchemaWorkResponse = {
	task_id: 12,
	target: { class_id: 10, revision: 2 },
	kind: "impact",
	status: "complete",
	start_epoch: 3,
	end_epoch: 3,
	current_epoch: 3,
	current_active_schema: { class_id: 10, revision: 1 },
	upper_bound: 2,
	cursor: 2,
	examined: 2,
	valid: 2,
	invalid: 0,
	not_required: 0,
	uninspectable: 0,
	stale: 0,
	invalid_samples: [],
	elapsed_millis: 10,
	batches: 1,
	created_at: active.created_at,
	readiness: "compatible",
	impact: {
		baseline: { class_id: 10, revision: 1 },
		failures: [],
		ungrouped_failures: 0,
		counts: {
			newly_invalid: 0,
			newly_valid: 0,
			still_invalid: 0,
			still_valid: 0,
			newly_required_valid: 2,
			no_longer_required: 0,
			unchanged_not_required: 0,
			uninspectable: 0,
		},
	},
};

describe("schema proposal admission", () => {
	it("preserves boolean schemas, including false", () => {
		expect(parseSchemaDraft("false", true)).toEqual({
			json_schema: false,
			validate_schema: true,
		});
		expect(parseSchemaDraft("true", true).json_schema).toBe(true);
	});
	it("removes a schema explicitly without enabling enforcement", () => {
		expect(parseSchemaDraft("", false)).toEqual({
			json_schema: null,
			validate_schema: false,
		});
		expect(() => parseSchemaDraft("null", true)).toThrow("Provide a schema");
	});
	it.each(["{", "[]", '"string"', "5"])(
		"rejects invalid schema input %s",
		(value) => {
			expect(() => parseSchemaDraft(value, false)).toThrow();
		},
	);
	it.each(["0", "-1", "2abc", "1.2", "1e3", "9007199254740992", "", null])(
		"rejects invalid route identity %s",
		(value) => expect(positiveSchemaId(value)).toBeNull(),
	);
});

describe("strict schema activation", () => {
	it("accepts a current compatible proof for the exact target and baseline", () => {
		expect(schemaActivationBlock(candidate, active, summary, work)).toBeNull();
	});
	it("allows an authoritative empty class without a scan", () => {
		expect(
			schemaActivationBlock(
				candidate,
				active,
				{
					...summary,
					counts: { valid: 0, invalid: 0, pending: 0, not_required: 0 },
				},
				undefined,
			),
		).toBeNull();
	});
	it("does not mistake absent or restricted counts for an empty class", () => {
		expect(
			schemaActivationBlock(candidate, active, null, undefined),
		).not.toBeNull();
	});
	it.each(["incompatible", "inconclusive", null] as const)(
		"rejects readiness %s despite zero invalid objects",
		(readiness) => {
			expect(
				schemaActivationBlock(candidate, active, summary, {
					...work,
					readiness,
				}),
			).not.toBeNull();
		},
	);
	it.each(["running", "failed", "cancelled", "superseded"] as const)(
		"rejects work status %s",
		(status) => {
			expect(
				schemaActivationBlock(candidate, active, summary, { ...work, status }),
			).not.toBeNull();
		},
	);
	it("rejects changed objects, changed baselines, and reports for other targets", () => {
		for (const changed of [
			{ ...work, current_epoch: 4 },
			{ ...work, current_active_schema: { class_id: 10, revision: 3 } },
			{ ...work, target: { class_id: 11, revision: 2 } },
			{ ...work, target: { class_id: 10, revision: 4 } },
			{ ...work, kind: "revalidation" as const },
			{ ...work, impact: null },
		])
			expect(
				schemaActivationBlock(candidate, active, summary, changed),
			).not.toBeNull();
		expect(
			schemaActivationBlock(
				candidate,
				active,
				{ ...summary, object_epoch: 4 },
				work,
			),
		).not.toBeNull();
	});
	it.each(["active", "retired", "abandoned"] as const)(
		"never activates a %s revision",
		(status) => {
			expect(
				schemaActivationBlock({ ...candidate, status }, active, summary, work),
			).not.toBeNull();
		},
	);
});
