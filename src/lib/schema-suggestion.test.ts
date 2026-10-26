import { describe, expect, it } from "vitest";
import type { TaskResponse } from "@/lib/api/generated/models";
import {
	taskMetadataFields,
	taskSchemaSuggestionHref,
} from "@/lib/task-metadata";

function task(
	classId: number,
	output: string,
): Pick<TaskResponse, "id" | "kind" | "details"> {
	return {
		id: 71,
		kind: "schema_profiling",
		details: { schema_profiling: { class_id: classId, output_url: output } },
	};
}

describe("schema suggestion navigation", () => {
	it("opens the guided review for the recorded class and task", () => {
		expect(
			taskSchemaSuggestionHref(
				task(12, "/api/v1/classes/12/schema/profiles/71"),
			),
		).toBe("/classes/12/schema?profile=71&step=schema");
	});
	it.each([
		[0, "/api/v1/classes/0/schema/profiles/71"],
		[12, "https://untrusted.test/report"],
		[12, "/api/v1/classes/13/schema/profiles/71"],
		[12, "/api/v1/classes/12/schema/profiles/72"],
	])(
		"rejects mismatched or untrusted output addresses: %s %s",
		(id, output) => {
			expect(taskSchemaSuggestionHref(task(id, output))).toBeNull();
		},
	);
	it("records the class without inventing report availability", () => {
		expect(
			taskMetadataFields(task(12, "/api/v1/classes/12/schema/profiles/71")),
		).toEqual([
			{ label: "Recorded target", value: "Class #12", href: "/classes/12" },
			{ label: "Report retention", value: "24 hours" },
		]);
	});
});

import type { SchemaProfileReport } from "@/lib/api/generated/models";
import { SchemaApiError } from "@/lib/api/schema-evolution";
import {
	schemaSuggestionError,
	schemaSuggestionFinding,
	usableSchemaSuggestion,
} from "@/lib/schema-suggestion";

const report: SchemaProfileReport = {
	class_id: 12,
	sampled: true,
	sampled_objects: 2,
	effective_sample_limit: 100,
	findings: [],
	options: { preset: "balanced", sample_limit: 100 },
	status: "candidate",
	sample_valid: true,
	schema: { type: "object" },
};

it.each([
	[{}, 12, true],
	[{}, 13, false],
	[{ status: "blocked" }, 12, false],
	[{ status: "insufficient" }, 12, false],
	[{ sample_valid: false }, 12, false],
	[{ schema: null }, 12, false],
] as const)(
	"only offers a reviewed candidate for its own class: %j",
	(change, id, valid) => {
		expect(usableSchemaSuggestion({ ...report, ...change }, id)).toBe(valid);
	},
);

it.each([
	[410, "expired"],
	[403, "access"],
	[404, "not available"],
])("explains report error %s", (status, expected) => {
	expect(schemaSuggestionError(new SchemaApiError(status, null))).toContain(
		expected,
	);
});

it("explains mixed types at an unambiguous literal-property and array path", () => {
	expect(
		schemaSuggestionFinding({
			kind: "mixed_types",
			path: [{ property: "a.b" }, "each_item", { property: "[#]" }],
			types: ["string", "number"],
		}),
	).toEqual({
		path: '$["a.b"][*]["[#]"]',
		message:
			"Observed types: string, number. Strict inference may reject this combination.",
	});
});

it.each([null, 3, [], { kind: "future_finding", path: [{ future: "node" }] }])(
	"keeps unknown finding shapes available without inventing a location: %j",
	(finding) => {
		expect(schemaSuggestionFinding(finding)).toEqual({
			path: null,
			message: "Additional inference detail.",
		});
	},
);

it("identifies optional root properties without suggesting missing values were null", () => {
	expect(
		schemaSuggestionFinding({
			kind: "optional_property",
			path: [{ property: "owner" }],
		}),
	).toEqual({
		path: '$["owner"]',
		message: "This property is optional in the suggestion.",
	});
});
