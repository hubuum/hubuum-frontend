"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { useConfirm } from "@/lib/confirm-context";
import {
	createComputedField,
	definitionRequestFromDraft,
	deleteComputedField,
	draftFromDefinition,
	EMPTY_COMPUTED_FIELD_DRAFT,
	fetchPersonalComputedFields,
	fetchSharedComputedFields,
	previewComputedField,
	rebuildSharedComputedFields,
	type ComputedFieldDraft,
	type ComputedFieldScope,
	type ComputedOperationType,
	updateComputedField,
} from "@/lib/api/computed-fields";
import type {
	ClassComputationState,
	ComputedFieldDefinition,
	ComputedFieldPreviewResponse,
	ComputedResultType,
} from "@/lib/api/generated/models";

const OPERATIONS: Array<{ value: ComputedOperationType; label: string }> = [
	{ value: "first_non_null", label: "First non-null" },
	{ value: "sum", label: "Sum" },
	{ value: "average", label: "Average" },
	{ value: "min", label: "Minimum" },
	{ value: "max", label: "Maximum" },
	{ value: "all_present", label: "All present" },
	{ value: "any_present", label: "Any present" },
	{ value: "count_present", label: "Count present" },
	{ value: "all_present_and_equal", label: "All present and equal" },
];

const RESULT_TYPES: ComputedResultType[] = [
	"string",
	"number",
	"integer",
	"boolean",
	"object",
	"array",
];

function cloneEmptyDraft(): ComputedFieldDraft {
	return { ...EMPTY_COMPUTED_FIELD_DRAFT };
}

function operationSummary(definition: ComputedFieldDefinition): string {
	const operation = definition.operation as {
		paths?: unknown;
		type?: unknown;
	};
	const type =
		typeof operation.type === "string"
			? operation.type.replaceAll("_", " ")
			: "operation";
	const pathCount = Array.isArray(operation.paths) ? operation.paths.length : 0;
	return `${type} · ${pathCount} path${pathCount === 1 ? "" : "s"}`;
}

function formatPreview(preview: ComputedFieldPreviewResponse): string {
	if (preview.error) {
		return `${preview.error.code}: ${preview.error.message}`;
	}
	const formatted = JSON.stringify(preview.value, null, 2);
	return formatted ?? String(preview.value);
}

type ScopeCardProps = {
	classId: number;
	definitions: ComputedFieldDefinition[];
	isLoading: boolean;
	loadError: Error | null;
	scope: ComputedFieldScope;
	state?: ClassComputationState;
};

function ComputedScopeCard({
	classId,
	definitions,
	isLoading,
	loadError,
	scope,
	state,
}: ScopeCardProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [isFormOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<ComputedFieldDefinition | null>(null);
	const [draft, setDraft] = useState<ComputedFieldDraft>(cloneEmptyDraft);
	const [previewMode, setPreviewMode] = useState<"object" | "data">("object");
	const [previewObjectId, setPreviewObjectId] = useState("");
	const [previewData, setPreviewData] = useState("{}");
	const [formError, setFormError] = useState<string | null>(null);
	const [preview, setPreview] = useState<ComputedFieldPreviewResponse | null>(
		null,
	);

	const queryKey = ["computed-fields", scope, classId];

	const saveMutation = useMutation({
		mutationFn: async () => {
			const request = definitionRequestFromDraft(draft);
			if (!editing) return createComputedField(scope, classId, request);
			return updateComputedField(scope, classId, editing.id, {
				...request,
				expected_revision: editing.revision,
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey });
			await queryClient.invalidateQueries({
				queryKey: ["objects", classId],
			});
			closeForm();
		},
		onError: (error) => {
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to save computed field.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (definition: ComputedFieldDefinition) =>
			deleteComputedField(scope, classId, definition),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey });
			await queryClient.invalidateQueries({
				queryKey: ["objects", classId],
			});
		},
	});

	const previewMutation = useMutation({
		mutationFn: async () => {
			const definition = definitionRequestFromDraft(draft);
			if (previewMode === "object") {
				const objectId = Number.parseInt(previewObjectId, 10);
				if (!Number.isInteger(objectId) || objectId < 1) {
					throw new Error("Enter a valid object ID for preview.");
				}
				return previewComputedField(scope, classId, {
					definition,
					object_id: objectId,
				});
			}

			let data: unknown;
			try {
				data = JSON.parse(previewData);
			} catch {
				throw new Error("Preview data must be valid JSON.");
			}
			if (typeof data !== "object" || data === null || Array.isArray(data)) {
				throw new Error("Preview data must be a JSON object.");
			}
			return previewComputedField(scope, classId, {
				data: data as Record<string, unknown>,
				definition,
			});
		},
		onSuccess: setPreview,
	});

	const rebuildMutation = useMutation({
		mutationFn: () => rebuildSharedComputedFields(classId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey });
		},
	});

	function openCreate() {
		setEditing(null);
		setDraft(cloneEmptyDraft());
		setFormError(null);
		setPreview(null);
		setFormOpen(true);
	}

	function openEdit(definition: ComputedFieldDefinition) {
		setEditing(definition);
		setDraft(draftFromDefinition(definition));
		setFormError(null);
		setPreview(null);
		setFormOpen(true);
	}

	function closeForm() {
		setEditing(null);
		setDraft(cloneEmptyDraft());
		setFormError(null);
		setPreview(null);
		setFormOpen(false);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		saveMutation.mutate();
	}

	async function onDelete(definition: ComputedFieldDefinition) {
		const accepted = await confirm({
			title: `Delete ${definition.label}?`,
			description:
				scope === "shared"
					? "This removes the shared field for every user and queues rematerialization."
					: "This removes your personal computed field.",
			confirmLabel: "Delete field",
			tone: "danger",
		});
		if (accepted) deleteMutation.mutate(definition);
	}

	return (
		<article className="card stack panel-card">
			<header className="relations-toolbar">
				<div>
					<p className="eyebrow">{scope}</p>
					<h3>{scope === "shared" ? "Shared fields" : "Personal fields"}</h3>
				</div>
				<button type="button" onClick={openCreate} disabled={isFormOpen}>
					New field
				</button>
			</header>
			<p className="muted">
				{scope === "shared"
					? "Shared definitions apply to every reader of this class and are materialized by background tasks."
					: "Personal definitions are stored by the server and visible only to you."}
			</p>

			{state ? (
				<div className="summary-grid">
					<div className="summary-pill">
						<span>Evaluation revision</span>
						<strong>{state.evaluation_revision}</strong>
					</div>
					<div className="summary-pill">
						<span>Rebuild status</span>
						<strong>{state.rebuild_status.replaceAll("_", " ")}</strong>
					</div>
					{state.active_task_id ? (
						<div className="summary-pill">
							<span>Active task</span>
							<strong>
								<Link href={`/tasks/${state.active_task_id}`}>
									#{state.active_task_id}
								</Link>
							</strong>
						</div>
					) : null}
				</div>
			) : null}

			{scope === "shared" && definitions.length > 0 ? (
				<div className="action-card-actions">
					<button
						className="ghost"
						type="button"
						onClick={() => rebuildMutation.mutate()}
						disabled={rebuildMutation.isPending}
					>
						{rebuildMutation.isPending ? "Queuing…" : "Rebuild values"}
					</button>
				</div>
			) : null}

			{isLoading ? <p>Loading computed fields…</p> : null}
			{loadError ? (
				<div className="error-banner" role="alert">
					{loadError.message}
				</div>
			) : null}
			{deleteMutation.isError ? (
				<div className="error-banner" role="alert">
					{deleteMutation.error.message}
				</div>
			) : null}
			{rebuildMutation.isError ? (
				<div className="error-banner" role="alert">
					{rebuildMutation.error.message}
				</div>
			) : null}

			{!isLoading && !loadError && definitions.length === 0 ? (
				<p className="muted">No {scope} computed fields yet.</p>
			) : null}
			{definitions.map((definition) => (
				<div className="object-detail-row" key={definition.id}>
					<div className="object-detail-label">
						{definition.enabled ? "Enabled" : "Disabled"}
					</div>
					<div className="object-detail-body">
						<strong>{definition.label}</strong>
						<code>{definition.key}</code>
						<span className="muted">
							{operationSummary(definition)} · {definition.result_type} · rev{" "}
							{definition.revision}
						</span>
						{definition.description ? (
							<span>{definition.description}</span>
						) : null}
					</div>
					<div className="object-detail-row-actions">
						<button
							className="ghost"
							type="button"
							onClick={() => openEdit(definition)}
							disabled={isFormOpen}
						>
							Edit
						</button>
						<button
							className="danger"
							type="button"
							onClick={() => onDelete(definition)}
							disabled={deleteMutation.isPending}
						>
							Delete
						</button>
					</div>
				</div>
			))}

			{isFormOpen ? (
				<form className="stack" onSubmit={onSubmit}>
					<h4>{editing ? `Edit ${editing.label}` : `New ${scope} field`}</h4>
					<div className="grid cols-2">
						<label className="control-field">
							<span>Key</span>
							<input
								required
								pattern="[a-z][a-z0-9_]{0,63}"
								value={draft.key}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										key: event.target.value,
									}))
								}
							/>
						</label>
						<label className="control-field">
							<span>Label</span>
							<input
								required
								value={draft.label}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										label: event.target.value,
									}))
								}
							/>
						</label>
						<label className="control-field">
							<span>Operation</span>
							<select
								value={draft.operationType}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										operationType: event.target.value as ComputedOperationType,
									}))
								}
							>
								{OPERATIONS.map((operation) => (
									<option key={operation.value} value={operation.value}>
										{operation.label}
									</option>
								))}
							</select>
						</label>
						<label className="control-field">
							<span>Result type</span>
							<select
								value={draft.resultType}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										resultType: event.target.value as ComputedResultType,
									}))
								}
							>
								{RESULT_TYPES.map((resultType) => (
									<option key={resultType} value={resultType}>
										{resultType}
									</option>
								))}
							</select>
						</label>
					</div>
					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							value={draft.description}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									description: event.target.value,
								}))
							}
						/>
					</label>
					<label className="control-field control-field--wide">
						<span>JSON Pointer paths, one per line</span>
						<textarea
							required
							rows={4}
							value={draft.pathsText}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									pathsText: event.target.value,
								}))
							}
							placeholder={"/price\n/tax"}
						/>
						<span className="muted">
							Use &lt;root&gt; for the complete object data document.
						</span>
					</label>
					<label className="checkbox-row">
						<input
							type="checkbox"
							checked={draft.enabled}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									enabled: event.target.checked,
								}))
							}
						/>
						Enabled
					</label>

					<fieldset className="relation-filters">
						<legend>Preview definition</legend>
						<div className="controls-row">
							<label className="control-field">
								<span>Preview source</span>
								<select
									value={previewMode}
									onChange={(event) =>
										setPreviewMode(event.target.value as "object" | "data")
									}
								>
									<option value="object">Existing object</option>
									<option value="data">Sample JSON data</option>
								</select>
							</label>
							{previewMode === "object" ? (
								<label className="control-field">
									<span>Object ID</span>
									<input
										type="number"
										min={1}
										value={previewObjectId}
										onChange={(event) => setPreviewObjectId(event.target.value)}
									/>
								</label>
							) : (
								<label className="control-field control-field--wide">
									<span>Sample JSON object</span>
									<textarea
										rows={4}
										value={previewData}
										onChange={(event) => setPreviewData(event.target.value)}
									/>
								</label>
							)}
						</div>
						<button
							className="ghost"
							type="button"
							onClick={() => previewMutation.mutate()}
							disabled={previewMutation.isPending}
						>
							{previewMutation.isPending ? "Evaluating…" : "Preview"}
						</button>
						{previewMutation.isError ? (
							<div className="error-banner" role="alert">
								{previewMutation.error.message}
							</div>
						) : null}
						{preview ? <pre>{formatPreview(preview)}</pre> : null}
					</fieldset>

					{formError ? (
						<div className="error-banner" role="alert">
							{formError}
						</div>
					) : null}
					<div className="form-actions">
						<button type="submit" disabled={saveMutation.isPending}>
							{saveMutation.isPending ? "Saving…" : "Save field"}
						</button>
						<button className="ghost" type="button" onClick={closeForm}>
							Cancel
						</button>
					</div>
				</form>
			) : null}
		</article>
	);
}

export function ComputedFieldsPanel({ classId }: { classId: number }) {
	const sharedQuery = useQuery({
		queryKey: ["computed-fields", "shared", classId],
		queryFn: () => fetchSharedComputedFields(classId),
	});
	const personalQuery = useQuery({
		queryKey: ["computed-fields", "personal", classId],
		queryFn: () => fetchPersonalComputedFields(classId),
	});

	return (
		<section id="computed-fields" className="stack">
			<header className="stack action-card-header">
				<div>
					<p className="eyebrow">Derived data</p>
					<h2>Computed fields</h2>
				</div>
				<p className="muted">
					Build typed values from JSON Pointer paths. Computed values appear on
					object reads but cannot be used for backend filtering or sorting.
				</p>
			</header>
			<div className="grid cols-2">
				<ComputedScopeCard
					classId={classId}
					definitions={sharedQuery.data?.definitions ?? []}
					isLoading={sharedQuery.isLoading}
					loadError={sharedQuery.error}
					scope="shared"
					state={sharedQuery.data?.state}
				/>
				<ComputedScopeCard
					classId={classId}
					definitions={personalQuery.data ?? []}
					isLoading={personalQuery.isLoading}
					loadError={personalQuery.error}
					scope="personal"
				/>
			</div>
		</section>
	);
}
