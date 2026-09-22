import { describe, expect, it } from "vitest";
import type {
	ClassSchemaResponse,
	SchemaRevisionResponse,
	SchemaWorkResponse,
} from "@/lib/api/generated/models";
import {
	parseSchemaDraft,
	positiveSchemaId,
	sameSchemaPolicy,
	schemaActivationBlock,
	schemaActivationLabel,
	schemaFlowStep,
	schemaTestPolicy,
	summarizeSchemaChanges,
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
	it("asks users to wait for running analysis rather than start another run", () => {
		expect(
			schemaActivationBlock(candidate, active, summary, {
				...work,
				status: "running",
			}),
		).toBe("Wait for the impact analysis to finish before activation.");
	});
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

describe("schema editing workflow", () => {
	it("keeps existing links usable with the new steps", () => {
		expect(schemaFlowStep("propose")).toBe("schema");
		expect(schemaFlowStep("impact")).toBe("review");
		expect(schemaFlowStep(null)).toBe("schema");
		expect(schemaFlowStep("validation")).toBe("validation");
	});
	it("compares the entire policy without treating JSON key order as a change", () => {
		const left = {
			json_schema: { type: "object", properties: {} },
			validate_schema: false,
		};
		expect(
			sameSchemaPolicy(left, {
				...left,
				json_schema: { properties: {}, type: "object" },
			}),
		).toBe(true);
		expect(sameSchemaPolicy(left, { ...left, validate_schema: true })).toBe(
			false,
		);
		expect(sameSchemaPolicy(left, { ...left, json_schema: false })).toBe(false);
	});
	it("tests an unenforced boolean schema without changing the selected policy", () => {
		const policy = { json_schema: false, validate_schema: false };
		expect(schemaTestPolicy(policy)).toEqual({
			json_schema: false,
			validate_schema: true,
		});
		expect(policy.validate_schema).toBe(false);
		expect(schemaTestPolicy({ ...policy, validate_schema: true })).toBeNull();
		expect(
			schemaTestPolicy({ json_schema: null, validate_schema: false }),
		).toBeNull();
	});
	it("states enforcement changes in the activation action", () => {
		expect(schemaActivationLabel(active, candidate)).toBe(
			"Activate schema & enable enforcement",
		);
		expect(schemaActivationLabel(candidate, active)).toBe(
			"Activate changes & turn off enforcement",
		);
		expect(schemaActivationLabel(candidate, candidate)).toBe("Activate schema");
	});
});

describe("schema change summaries", () => {
	it("summarizes an enforcement toggle without a document diff", () => {
		const policy = { json_schema: { type: "object" }, validate_schema: false };
		expect(
			summarizeSchemaChanges(policy, { ...policy, validate_schema: true }),
		).toEqual({
			schema: "unchanged",
			enforcement: "enabled",
			documentChanges: [],
		});
		expect(
			summarizeSchemaChanges({ ...policy, validate_schema: true }, policy)
				.enforcement,
		).toBe("disabled");
	});
	it("treats a boolean false schema as a document when adding and removing it", () => {
		const empty = { json_schema: null, validate_schema: false };
		const policy = { json_schema: false, validate_schema: false };
		expect(summarizeSchemaChanges(empty, policy).schema).toBe("added");
		expect(summarizeSchemaChanges(policy, empty).schema).toBe("removed");
	});
	it("keeps document paths relative to the schema, including similarly named properties", () => {
		const before = {
			json_schema: { properties: { validate_schema: { type: "string" } } },
			validate_schema: true,
		};
		const after = {
			...before,
			json_schema: { properties: { validate_schema: { type: "boolean" } } },
		};
		const result = summarizeSchemaChanges(before, after);
		expect(result.schema).toBe("updated");
		expect(result.enforcement).toBe("unchanged");
		expect(result.documentChanges.map((change) => change.path)).toEqual([
			"/properties/validate_schema/type",
		]);
	});
});
