import { hubuumBffPath } from "@/lib/api/frontend";
import type {
	TaskDiscoveryTarget,
	TaskResponse,
} from "@/lib/api/generated/models";
import { taskValueLabel } from "@/lib/task-discovery";

export type TaskMetadataField = { label: string; value: string; href?: string };
const positiveId = (id: number | null | undefined): id is number =>
	typeof id === "number" && Number.isSafeInteger(id) && id > 0;

function targetField(
	target: TaskDiscoveryTarget | null | undefined,
): TaskMetadataField {
	if (!target) return { label: "Recorded target", value: "Unknown" };
	switch (target.type) {
		case "class":
			return {
				label: "Recorded target",
				value: `Class #${target.class_id}`,
				href: positiveId(target.class_id)
					? `/classes/${target.class_id}`
					: undefined,
			};
		case "collection":
			return {
				label: "Recorded target",
				value: `Collection #${target.collection_id}`,
				href: positiveId(target.collection_id)
					? `/collections/${target.collection_id}`
					: undefined,
			};
		case "object":
			return {
				label: "Recorded target",
				value: `Object #${target.object_id}${target.class_id != null ? ` (class #${target.class_id})` : ""}`,
				href:
					positiveId(target.class_id) && positiveId(target.object_id)
						? `/objects/${target.class_id}/${target.object_id}`
						: undefined,
			};
		case "class_relation":
			return {
				label: "Recorded target",
				value: `Class relation #${target.relation_id}`,
			};
		case "object_relation":
			return {
				label: "Recorded target",
				value: `Object relation #${target.relation_id}`,
			};
	}
}

export function taskMetadataFields(
	task: Pick<TaskResponse, "kind" | "details">,
): TaskMetadataField[] {
	const fields: TaskMetadataField[] = [];
	const add = (
		label: string,
		value: string | number | boolean | null | undefined,
	) => fields.push({ label, value: taskValueLabel(value) });
	const details = task.details;
	if (task.kind === "import" && details?.import) {
		const retained = details.import.retained;
		add("Dry run", retained?.dry_run);
		add("Atomicity", retained?.atomicity);
		add("Collision policy", retained?.collision_policy);
		add("Permission policy", retained?.permission_policy);
		add("Has failed items", retained?.has_failed_items);
	} else if (task.kind === "export" && details?.export) {
		const detail = details.export;
		const retained = detail.retained;
		add(
			"Output state",
			retained?.output_state ??
				(detail.output_available
					? "available"
					: detail.output_expired
						? "expired"
						: "unknown"),
		);
		add("Export scope", retained?.scope_kind);
		fields.push(targetField(retained?.target));
		fields.push({
			label: "Template ID",
			value:
				retained?.template_id == null ? "Unknown" : `#${retained.template_id}`,
			href: positiveId(retained?.template_id)
				? `/exports/templates/${retained.template_id}`
				: undefined,
		});
		add("Missing data policy", retained?.missing_data_policy);
		add("Maximum items", retained?.max_items);
		add("Maximum output bytes", retained?.max_output_bytes);
		add(
			"Retained warning count",
			retained?.warning_count ?? detail.warning_count,
		);
		add("Retained truncation outcome", retained?.truncated ?? detail.truncated);
	} else if (task.kind === "backup" && details?.backup) {
		const detail = details.backup;
		add("Includes history", detail.retained?.include_history);
		add(
			"Output state",
			detail.retained?.output_state ??
				(detail.output_available
					? "available"
					: detail.output_expired
						? "expired"
						: "unknown"),
		);
		add("Output bytes", detail.byte_size);
		add("Output SHA-256", detail.sha256);
		add("Output expires", detail.output_expires_at);
	} else if (task.kind === "reindex" && details?.reindex) {
		const detail = details.reindex;
		fields.push(
			targetField(
				detail.class_id == null
					? null
					: { type: "class", class_id: detail.class_id },
			),
		);
		add("Computation revision", detail.computation_revision);
	} else if (task.kind === "schema_validation" && details?.schema_validation) {
		const detail = details.schema_validation;
		fields.push(
			targetField(
				detail.class_id == null
					? null
					: { type: "class", class_id: detail.class_id },
			),
		);
		add("Schema revision", detail.schema_revision);
		add("Schema work kind", detail.work_kind);
		add("Schema work status", detail.work_status);
	} else if (task.kind === "remote_call" && details?.remote_call) {
		const detail = details.remote_call;
		add("Remote target ID", detail.remote_target_id);
		fields.push(targetField(detail.target));
	}
	return fields;
}

export function taskOutputHref(
	task: Pick<TaskResponse, "id" | "kind" | "details">,
): string | null {
	if (!positiveId(task.id)) return null;
	const detail =
		task.kind === "export"
			? task.details?.export
			: task.kind === "backup"
				? task.details?.backup
				: null;
	const expected = `/api/v1/${task.kind === "export" ? "exports" : "backups"}/${task.id}/output`;
	return detail?.output_available && detail.output_url === expected
		? hubuumBffPath(expected)
		: null;
}

export function taskSchemaReportHref(
	task: Pick<TaskResponse, "id" | "kind" | "details">,
): string | null {
	const detail =
		task.kind === "schema_validation" ? task.details?.schema_validation : null;
	if (!positiveId(task.id) || !positiveId(detail?.class_id)) return null;
	const expected = `/api/v1/classes/${detail.class_id}/schema/tasks/${task.id}/report`;
	return detail?.results_url === expected ? hubuumBffPath(expected) : null;
}
