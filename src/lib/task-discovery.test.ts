import { describe, expect, it } from "vitest";
import {
	defaultTaskSort,
	parseTaskFilters,
	taskFilterDraft,
	taskFilterParams,
	taskSearchParams,
	taskSortError,
} from "@/lib/task-discovery";

describe("task discovery filters", () => {
	it("preserves explicit false, zero revisions, lists and timezone offsets", () => {
		const params = new URLSearchParams({
			class_id: "42",
			computation_revision: "0",
			kind: "reindex,schema_validation",
			status: "succeeded,failed",
			terminal: "true",
			cancel_requested: "false",
			created_after: "2026-09-22T12:00:00+02:00",
		});
		expect(parseTaskFilters(params)).toEqual({
			errors: [],
			filters: {
				class_id: 42,
				computation_revision: 0,
				kind: "reindex,schema_validation",
				status: "succeeded,failed",
				terminal: true,
				cancel_requested: false,
				created_after: "2026-09-22T12:00:00+02:00",
			},
		});
		expect(
			Object.fromEntries(taskFilterParams(taskFilterDraft(params))),
		).toEqual(Object.fromEntries(params));
	});
	it.each([
		["class_id=1x", "Class ID"],
		["class_id=-1", "Class ID"],
		["class_id=1.5", "Class ID"],
		["class_id=9007199254740992", "Class ID"],
		["schema_revision=0&class_id=1", "Schema revision"],
		["schema_revision=2", "requires a class"],
		["computation_revision=0", "requires a class"],
		["relation_id=7", "required together"],
		["relation_type=class_relation", "required together"],
		["import_dry_run=0", "Yes or No"],
		["kind=export,export", "without duplicates"],
		["status=unknown", "valid"],
		["status=running,succeeded&terminal=true", "agree"],
		["status=cancelled&terminal=false", "agree"],
		["created_after=2026-09-22T12:00:00", "timezone"],
		[
			"created_after=2026-09-22T12:00:00Z&created_before=2026-09-22T12:00:00Z",
			"earlier",
		],
		["trace_id=00000000000000000000000000000000", "nonzero"],
		["trace_id=123", "32 hexadecimal"],
		["class_id=1&class_id=2", "only once"],
	])("rejects invalid filters: %s", (query, message) => {
		expect(
			parseTaskFilters(new URLSearchParams(query)).errors.join(" "),
		).toContain(message);
	});
	it("supports all additional discovery fields", () => {
		const params = new URLSearchParams({
			class_id: "1",
			object_id: "2",
			collection_id: "3",
			relation_type: "object_relation",
			relation_id: "4",
			schema_revision: "5",
			schema_work_kind: "impact",
			schema_work_status: "superseded",
			computation_revision: "0",
			remote_target_id: "6",
			remote_side_effect_state: "legacy_unknown",
			export_scope_kind: "related_objects",
			export_template_id: "7",
			export_has_warnings: "false",
			export_truncated: "false",
			import_dry_run: "false",
			import_atomicity: "strict",
			import_collision_policy: "overwrite",
			import_permission_policy: "continue",
			import_has_failed_items: "false",
			backup_include_history: "false",
			output_state: "unknown",
		});
		const result = parseTaskFilters(params);
		expect(result.errors).toEqual([]);
		expect(
			Object.fromEntries(
				Object.entries(result.filters).map(([key, value]) => [
					key,
					String(value),
				]),
			),
		).toEqual(Object.fromEntries(params));
	});
	it("resets pagination when applying filters and excludes unrelated query parameters", () => {
		const old = new URLSearchParams(
			"scope=all&cursor=old&class_id=42&export_truncated=false&limit=20&unexpected=1",
		);
		const next = taskSearchParams(
			taskFilterDraft(old),
			"all",
			defaultTaskSort,
			20,
		);
		expect(Object.fromEntries(next)).toEqual({
			scope: "all",
			class_id: "42",
			export_truncated: "false",
			limit: "20",
		});
	});
	it("validates supported sort fields and directions", () => {
		expect(taskSortError("submitted_by.asc,id.desc")).toBeNull();
		for (const sort of [
			"id",
			"id.up",
			"id.asc,id.desc",
			"id.desc,",
			"trace_id.asc",
			"",
		])
			expect(taskSortError(sort)).not.toBeNull();
	});
});
