import type { GetApiV1TasksParams } from "@/lib/api/generated/models";

export type TaskFilters = Omit<
	GetApiV1TasksParams,
	"cursor" | "limit" | "sort" | "include_total"
>;
type Field = {
	key: keyof TaskFilters;
	label: string;
	type: "number" | "boolean" | "select" | "list" | "time" | "text";
	options?: readonly string[];
	minimum?: number;
};
export const taskFilterGroups: readonly {
	label: string;
	fields: readonly Field[];
}[] = [
	{
		label: "Lifecycle",
		fields: [
			{
				key: "kind",
				label: "Task kinds",
				type: "list",
				options: [
					"import",
					"export",
					"backup",
					"reindex",
					"remote_call",
					"schema_validation",
				],
			},
			{
				key: "status",
				label: "Task statuses",
				type: "list",
				options: [
					"queued",
					"validating",
					"running",
					"succeeded",
					"failed",
					"partially_succeeded",
					"cancelled",
				],
			},
			{ key: "terminal", label: "Completed tasks", type: "boolean" },
			{
				key: "cancel_requested",
				label: "Cancellation requested",
				type: "boolean",
			},
			{
				key: "terminal_reason",
				label: "Completion reason",
				type: "select",
				options: ["cancel_requested", "deadline_exceeded"],
			},
			{
				key: "submitted_by",
				label: "Submitter ID (administrators)",
				type: "number",
			},
			{ key: "trace_id", label: "Trace ID", type: "text" },
		],
	},
	{
		label: "Resources and revisions",
		fields: [
			{ key: "class_id", label: "Class ID", type: "number" },
			{ key: "object_id", label: "Object ID", type: "number" },
			{ key: "collection_id", label: "Collection ID", type: "number" },
			{
				key: "relation_type",
				label: "Relation type",
				type: "select",
				options: ["class_relation", "object_relation"],
			},
			{ key: "relation_id", label: "Relation ID", type: "number" },
			{ key: "schema_revision", label: "Schema revision", type: "number" },
			{
				key: "schema_work_kind",
				label: "Schema work kind",
				type: "select",
				options: ["impact", "revalidation"],
			},
			{
				key: "schema_work_status",
				label: "Schema work status",
				type: "select",
				options: ["running", "failed", "complete", "cancelled", "superseded"],
			},
			{
				key: "computation_revision",
				label: "Computation revision",
				type: "number",
				minimum: 0,
			},
		],
	},
	{
		label: "Time ranges",
		fields: [
			{ key: "created_after", label: "Created at or after", type: "time" },
			{ key: "created_before", label: "Created before", type: "time" },
			{ key: "started_after", label: "Started at or after", type: "time" },
			{ key: "started_before", label: "Started before", type: "time" },
			{ key: "finished_after", label: "Finished at or after", type: "time" },
			{ key: "finished_before", label: "Finished before", type: "time" },
		],
	},
	{
		label: "Export and output",
		fields: [
			{
				key: "export_scope_kind",
				label: "Export scope",
				type: "select",
				options: [
					"collections",
					"classes",
					"objects_in_class",
					"class_relations",
					"object_relations",
					"related_objects",
				],
			},
			{
				key: "export_template_id",
				label: "Export template ID",
				type: "number",
			},
			{
				key: "export_has_warnings",
				label: "Export has warnings",
				type: "boolean",
			},
			{ key: "export_truncated", label: "Export truncated", type: "boolean" },
			{
				key: "output_state",
				label: "Output state (exports and backups)",
				type: "select",
				options: ["available", "expired", "not_produced", "unknown"],
			},
		],
	},
	{
		label: "Import",
		fields: [
			{ key: "import_dry_run", label: "Import dry run", type: "boolean" },
			{
				key: "import_atomicity",
				label: "Import atomicity",
				type: "select",
				options: ["strict", "best_effort"],
			},
			{
				key: "import_collision_policy",
				label: "Import collision policy",
				type: "select",
				options: ["abort", "overwrite"],
			},
			{
				key: "import_permission_policy",
				label: "Import permission policy",
				type: "select",
				options: ["abort", "continue"],
			},
			{
				key: "import_has_failed_items",
				label: "Import has failed items",
				type: "boolean",
			},
		],
	},
	{
		label: "Backup and remote calls",
		fields: [
			{
				key: "backup_include_history",
				label: "Backup includes history",
				type: "boolean",
			},
			{ key: "remote_target_id", label: "Remote target ID", type: "number" },
			{
				key: "remote_side_effect_state",
				label: "Remote dispatch state",
				type: "select",
				options: ["not_sent", "possibly_sent", "legacy_unknown"],
			},
		],
	},
];
export const taskFilterFields = taskFilterGroups.flatMap(
	(group) => group.fields,
);
export type TaskFilterDraft = Partial<Record<keyof TaskFilters, string>>;
export const defaultTaskSort = "created_at.desc,id.desc";

export function taskFilterDraft(params: URLSearchParams): TaskFilterDraft {
	return Object.fromEntries(
		taskFilterFields.map(({ key }) => [key, params.get(key) ?? ""]),
	);
}

export function taskFilterParams(draft: TaskFilterDraft): URLSearchParams {
	const params = new URLSearchParams();
	for (const { key } of taskFilterFields) {
		const value = draft[key]?.trim();
		if (value) params.set(key, value);
	}
	return params;
}

export function parseTaskFilters(params: URLSearchParams): {
	filters: TaskFilters;
	errors: string[];
} {
	const filters: Record<string, string | number | boolean> = {};
	const errors: string[] = [];
	for (const field of taskFilterFields) {
		const raw = params.get(field.key)?.trim();
		if (params.getAll(field.key).length > 1)
			errors.push(`${field.label} must be specified only once.`);
		if (!raw) continue;
		if (field.type === "number") {
			const value = Number(raw);
			if (
				!/^\d+$/.test(raw) ||
				!Number.isSafeInteger(value) ||
				value < (field.minimum ?? 1)
			) {
				errors.push(
					`${field.label} must be an integer of at least ${field.minimum ?? 1}.`,
				);
			} else filters[field.key] = value;
		} else if (field.type === "boolean") {
			if (raw !== "true" && raw !== "false")
				errors.push(`${field.label} must be Yes or No.`);
			else filters[field.key] = raw === "true";
		} else if (field.type === "list" || field.type === "select") {
			const values = field.type === "list" ? raw.split(",") : [raw];
			if (
				values.some((value) => !field.options?.includes(value)) ||
				new Set(values).size !== values.length
			) {
				errors.push(
					`Choose valid ${field.label.toLowerCase()} without duplicates.`,
				);
			} else filters[field.key] = raw;
		} else if (field.type === "time") {
			if (
				!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(
					raw,
				) ||
				!Number.isFinite(Date.parse(raw))
			) {
				errors.push(
					`${field.label} needs an RFC 3339 timestamp with a timezone, such as 2026-09-22T12:00:00Z.`,
				);
			} else filters[field.key] = raw;
		} else {
			if (!/^[a-f0-9]{32}$/i.test(raw) || /^0+$/.test(raw))
				errors.push("Trace ID must be 32 hexadecimal digits and nonzero.");
			else filters[field.key] = raw;
		}
	}
	if (Boolean(filters.relation_type) !== Boolean(filters.relation_id))
		errors.push("Relation type and relation ID are required together.");
	if (
		(filters.schema_revision != null || filters.computation_revision != null) &&
		!filters.class_id
	)
		errors.push("A schema or computation revision requires a class ID.");
	for (const prefix of ["created", "started", "finished"]) {
		const after = filters[`${prefix}_after`];
		const before = filters[`${prefix}_before`];
		if (
			typeof after === "string" &&
			typeof before === "string" &&
			Date.parse(after) >= Date.parse(before)
		)
			errors.push(
				`The ${prefix} lower bound must be earlier than the upper bound.`,
			);
	}
	if (
		typeof filters.terminal === "boolean" &&
		typeof filters.status === "string"
	) {
		const terminal = new Set([
			"succeeded",
			"failed",
			"partially_succeeded",
			"cancelled",
		]);
		if (
			filters.status
				.split(",")
				.some((status) => terminal.has(status) !== filters.terminal)
		)
			errors.push(
				"Completed tasks must agree with every selected task status.",
			);
	}
	// Each allowed key and its value type is validated using the field definitions above.
	return { filters: filters as TaskFilters, errors };
}

export function taskSortError(sort: string): string | null {
	const fields = sort.split(",");
	return fields.length > 0 &&
		fields.every((field) =>
			/^(id|kind|status|submitted_by|created_at|started_at|finished_at)\.(asc|desc)$/.test(
				field,
			),
		) &&
		new Set(fields.map((field) => field.split(".")[0])).size === fields.length
		? null
		: "Choose a valid task sort order without duplicate fields.";
}

export function taskSearchParams(
	draft: TaskFilterDraft,
	scope: string,
	sort: string,
	limit: number,
): URLSearchParams {
	const params = taskFilterParams(draft);
	if (scope === "all") params.set("scope", "all");
	if (sort !== defaultTaskSort) params.set("sort", sort);
	params.set("limit", String(limit));
	return params;
}

export function taskValueLabel(
	value: string | number | boolean | null | undefined,
): string {
	if (value == null) return "Unknown";
	if (typeof value === "boolean") return value ? "Yes" : "No";
	return String(value).replaceAll("_", " ");
}
