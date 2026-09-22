import { describe, expect, it } from "vitest";
import type { TaskResponse } from "@/lib/api/generated/models";
import {
	taskMetadataFields,
	taskOutputHref,
	taskSchemaReportHref,
} from "@/lib/task-metadata";

describe("retained task metadata", () => {
	it("keeps false, zero and unknown outcomes distinct", () => {
		const fields = taskMetadataFields({
			kind: "import",
			details: {
				import: {
					results_url: "/api/v1/imports/7/results",
					retained: {
						dry_run: false,
						has_failed_items: null,
						atomicity: "best_effort",
					},
				},
			},
		});
		expect(fields).toContainEqual({ label: "Dry run", value: "No" });
		expect(fields).toContainEqual({
			label: "Has failed items",
			value: "Unknown",
		});
		expect(
			taskMetadataFields({
				kind: "reindex",
				details: { reindex: { class_id: 42, computation_revision: 0 } },
			}),
		).toContainEqual({ label: "Computation revision", value: "0" });
	});
	it("uses retained export outcomes after output expiry", () => {
		const fields = taskMetadataFields({
			kind: "export",
			details: {
				export: {
					output_url: "",
					output_available: false,
					output_expired: true,
					retained: {
						output_state: "expired",
						warning_count: 0,
						truncated: false,
						max_items: 0,
						target: { type: "object", object_id: 8 },
						template_id: 9,
					},
				},
			},
		});
		expect(fields).toContainEqual({ label: "Output state", value: "expired" });
		expect(fields).toContainEqual({
			label: "Retained warning count",
			value: "0",
		});
		expect(fields).toContainEqual({
			label: "Retained truncation outcome",
			value: "No",
		});
		expect(
			fields.find(({ label }) => label === "Recorded target")?.href,
		).toBeUndefined();
		expect(fields).toContainEqual({
			label: "Template ID",
			value: "#9",
			href: "/exports/templates/9",
		});
	});
	it("does not invent metadata or links when the server suppresses details", () => {
		for (const kind of [
			"import",
			"export",
			"backup",
			"reindex",
			"schema_validation",
			"remote_call",
		] as const) {
			const task = { id: 7, kind, details: null };
			expect(taskMetadataFields(task)).toEqual([]);
			expect(taskOutputHref(task)).toBeNull();
			expect(taskSchemaReportHref(task)).toBeNull();
		}
	});
	it("links only the matching server-provided output through the BFF", () => {
		for (const kind of ["export", "backup"] as const) {
			const output_url = `/api/v1/${kind}s/7/output`;
			const task: Pick<TaskResponse, "id" | "kind" | "details"> = {
				id: 7,
				kind,
				details: {
					[kind]: { output_url, output_available: true, output_expired: false },
				},
			};
			expect(taskOutputHref(task)).toBe(`/_hubuum-bff/hubuum${output_url}`);
			for (const url of [
				"",
				"https://example.com/",
				"//example.com",
				"javascript:alert(1)",
				output_url.replace("/7/", "/8/"),
			]) {
				expect(
					taskOutputHref({
						...task,
						details: {
							[kind]: {
								output_url: url,
								output_available: true,
								output_expired: false,
							},
						},
					}),
				).toBeNull();
			}
			expect(
				taskOutputHref({
					...task,
					details: {
						[kind]: {
							output_url,
							output_available: false,
							output_expired: true,
						},
					},
				}),
			).toBeNull();
		}
	});
	it("links a schema report only with its recorded class and task identity", () => {
		const task = {
			id: 7,
			kind: "schema_validation" as const,
			details: {
				schema_validation: {
					class_id: 42,
					results_url: "/api/v1/classes/42/schema/tasks/7/report",
					schema_revision: 2,
					work_status: "superseded" as const,
				},
			},
		};
		expect(taskSchemaReportHref(task)).toBe(
			"/_hubuum-bff/hubuum/api/v1/classes/42/schema/tasks/7/report",
		);
		expect(taskSchemaReportHref({ ...task, id: 8 })).toBeNull();
		expect(
			taskSchemaReportHref({
				...task,
				details: {
					schema_validation: {
						results_url: task.details.schema_validation.results_url,
					},
				},
			}),
		).toBeNull();
		expect(taskMetadataFields(task)).toContainEqual({
			label: "Schema work status",
			value: "superseded",
		});
	});
});
