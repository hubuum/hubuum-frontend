"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useState,
} from "react";
import { EmptyState } from "@/components/empty-state";
import { JsonEditor } from "@/components/json-editor";
import { RemoteInvocationsPanel } from "@/components/remote-invocations-panel";
import { ResourceActivityPanel } from "@/components/resource-activity-panel";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1ClassesByClassId,
	getApiV1Classes,
	getApiV1ClassesByClassId,
	getApiV1Namespaces,
	patchApiV1ClassesByClassId,
} from "@/lib/api/generated/client";
import type {
	HubuumClassExpanded,
	HubuumClassRelation,
	Namespace,
	UpdateHubuumClass,
} from "@/lib/api/generated/models";
import {
	EDIT_STATE_EVENT,
	type EditStateEventDetail,
	TITLE_STATE_EVENT,
} from "@/lib/create-events";
import { summarizeJsonDocument } from "@/lib/json-inspector";

type ClassDetailProps = {
	classId: number;
};

type EditableField =
	| "name"
	| "description"
	| "namespace"
	| "validate_schema"
	| "json_schema";

const ALL_EDITABLE_FIELDS: EditableField[] = [
	"name",
	"description",
	"namespace",
	"validate_schema",
	"json_schema",
];

async function fetchClass(classId: number): Promise<HubuumClassExpanded> {
	const response = await getApiV1ClassesByClassId(classId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load class."));
	}

	return response.data;
}

async function fetchNamespaces(): Promise<Namespace[]> {
	const response = await getApiV1Namespaces(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load namespaces."),
		);
	}

	return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ limit: 250 },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	return response.data;
}

async function parseJsonPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

async function fetchClassRelations(
	classId: number,
): Promise<HubuumClassRelation[]> {
	const response = await fetch(`/_hubuum-bff/classes/${classId}/relations`, {
		credentials: "include",
	});
	const payload = await parseJsonPayload(response);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to load class relations."),
		);
	}

	return expectArrayPayload<HubuumClassRelation>(payload, "class relations");
}

function formatTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
}

function renderFieldText(value: string): string {
	return value.trim() ? value : "No value";
}

function stringifyJsonSchema(value: unknown): string {
	if (value === undefined) {
		return "";
	}

	const formatted = JSON.stringify(value, null, 2);
	return formatted ?? "";
}

function InlineEditIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="m4 16.8 8.9-8.9 3.2 3.2-8.9 8.9H4Zm10-10 1.8-1.8a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5l-1.8 1.8Z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function ClassDetail({ classId }: ClassDetailProps) {
	const router = useRouter();
	const queryClient = useQueryClient();

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [namespaceId, setNamespaceId] = useState("");
	const [validateSchema, setValidateSchema] = useState(false);
	const [jsonSchemaInput, setJsonSchemaInput] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [editingFields, setEditingFields] = useState<EditableField[]>([]);
	const [isSchemaExpanded, setSchemaExpanded] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const classQuery = useQuery({
		queryKey: ["class", classId],
		queryFn: async () => fetchClass(classId),
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "class-detail"],
		queryFn: fetchClasses,
	});
	const namespacesQuery = useQuery({
		queryKey: ["namespaces", "class-detail"],
		queryFn: fetchNamespaces,
	});
	const classRelationsQuery = useQuery({
		queryKey: ["class-relations", "detail", classId],
		queryFn: async () => fetchClassRelations(classId),
	});

	useEffect(() => {
		if (!classQuery.data) {
			return;
		}

		if (!initialized || editingFields.length === 0) {
			setName(classQuery.data.name);
			setDescription(classQuery.data.description ?? "");
			setNamespaceId(String(classQuery.data.namespace.id));
			setValidateSchema(classQuery.data.validate_schema);
			setJsonSchemaInput(stringifyJsonSchema(classQuery.data.json_schema));
			setInitialized(true);
		}
	}, [classQuery.data, editingFields.length, initialized]);

	const updateMutation = useMutation({
		mutationFn: async (payload: UpdateHubuumClass) => {
			const response = await patchApiV1ClassesByClassId(classId, payload, {
				credentials: "include",
			});

			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to update class."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["class", classId] });
			await queryClient.invalidateQueries({ queryKey: ["classes"] });
			await queryClient.invalidateQueries({
				queryKey: ["classes", "object-explorer"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["classes", "relations-explorer"],
			});
			setEditingFields([]);
			setFormError(null);
			setFormSuccess("Class updated.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to update class.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const response = await deleteApiV1ClassesByClassId(classId, {
				credentials: "include",
			});

			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to delete class."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["classes"] });
			await queryClient.invalidateQueries({
				queryKey: ["classes", "object-explorer"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["classes", "relations-explorer"],
			});
			router.push("/classes");
			router.refresh();
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to delete class.",
			);
		},
	});

	function resetFieldDraft(
		field: EditableField,
		classData: HubuumClassExpanded,
	) {
		if (field === "name") {
			setName(classData.name);
			return;
		}

		if (field === "description") {
			setDescription(classData.description ?? "");
			return;
		}

		if (field === "namespace") {
			setNamespaceId(String(classData.namespace.id));
			return;
		}

		if (field === "validate_schema") {
			setValidateSchema(classData.validate_schema);
			return;
		}

		setJsonSchemaInput(stringifyJsonSchema(classData.json_schema));
	}

	function toggleFieldEditing(
		field: EditableField,
		classData: HubuumClassExpanded,
	) {
		setFormError(null);
		setFormSuccess(null);

		if (editingFields.includes(field)) {
			resetFieldDraft(field, classData);
			setEditingFields((current) =>
				current.filter((currentField) => currentField !== field),
			);
			return;
		}

		setEditingFields((current) => [...current, field]);
	}

	const hasActiveEdits = editingFields.length > 0;
	const isSavingOrDeleting =
		updateMutation.isPending || deleteMutation.isPending;
	const beginGlobalEdit = useCallback(() => {
		if (hasActiveEdits || isSavingOrDeleting) {
			return;
		}

		setFormError(null);
		setFormSuccess(null);
		setEditingFields(ALL_EDITABLE_FIELDS);
	}, [hasActiveEdits, isSavingOrDeleting]);

	const cancelActiveEdits = useCallback(() => {
		const classData = classQuery.data;
		if (!classData || editingFields.length === 0) {
			return;
		}

		setName(classData.name);
		setDescription(classData.description ?? "");
		setNamespaceId(String(classData.namespace.id));
		setValidateSchema(classData.validate_schema);
		setJsonSchemaInput(stringifyJsonSchema(classData.json_schema));
		setEditingFields([]);
		setFormError(null);
		setFormSuccess(null);
	}, [classQuery.data, editingFields.length]);

	useEffect(() => {
		const detail: EditStateEventDetail = {
			label: "Edit class",
			editHandler: !hasActiveEdits && !isSavingOrDeleting ? beginGlobalEdit : null,
		};

		window.dispatchEvent(new CustomEvent(EDIT_STATE_EVENT, { detail }));

		return () => {
			window.dispatchEvent(
				new CustomEvent(EDIT_STATE_EVENT, {
					detail: { label: "Edit class", editHandler: null },
				}),
			);
		};
	}, [beginGlobalEdit, hasActiveEdits, isSavingOrDeleting]);

	useEffect(() => {
		const classData = classQuery.data;
		if (!classData) {
			return;
		}

		window.dispatchEvent(
			new CustomEvent(TITLE_STATE_EVENT, {
				detail: {
					title: classData.name,
					pin: {
						type: "class",
						id: classData.id,
						name: classData.name,
						namespaceId: classData.namespace.id,
						namespaceName: classData.namespace.name,
					},
				},
			}),
		);

		return () => {
			window.dispatchEvent(
				new CustomEvent(TITLE_STATE_EVENT, {
					detail: { title: null, pin: null },
				}),
			);
		};
	}, [classQuery.data]);

	useEffect(() => {
		if (!hasActiveEdits) {
			return;
		}

		function onEscape(event: KeyboardEvent) {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			cancelActiveEdits();
		}

		document.addEventListener("keydown", onEscape);
		return () => document.removeEventListener("keydown", onEscape);
	}, [cancelActiveEdits, hasActiveEdits]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const parsedNamespaceId = Number.parseInt(namespaceId, 10);
		if (!Number.isFinite(parsedNamespaceId) || parsedNamespaceId < 1) {
			setFormError("Namespace is required.");
			return;
		}

		let parsedJsonSchema: unknown;
		if (jsonSchemaInput.trim()) {
			try {
				parsedJsonSchema = JSON.parse(jsonSchemaInput);
			} catch {
				setFormError("JSON schema is not valid JSON.");
				return;
			}
		}

		const payload: UpdateHubuumClass = {
			name: name.trim(),
			description: description.trim(),
			namespace_id: parsedNamespaceId,
			validate_schema: validateSchema,
		};

		if (parsedJsonSchema !== undefined) {
			payload.json_schema = parsedJsonSchema;
		}

		updateMutation.mutate(payload);
	}

	function onSubmitShortcut(event: ReactKeyboardEvent<HTMLFormElement>) {
		if (event.key === "Escape" && hasActiveEdits) {
			event.preventDefault();
			event.stopPropagation();
			cancelActiveEdits();
			return;
		}

		if (
			event.key !== "Enter" ||
			!event.shiftKey ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		) {
			return;
		}

		const submitButton =
			event.currentTarget.querySelector<HTMLButtonElement>(
				"button[type='submit']:not(:disabled)",
			);
		if (!submitButton) {
			return;
		}

		event.preventDefault();
		event.currentTarget.requestSubmit(submitButton);
	}

	function onDelete() {
		setFormError(null);
		setFormSuccess(null);
		const classLabel = classQuery.data?.name ?? "this class";
		if (!window.confirm(`Delete ${classLabel}?`)) {
			return;
		}

		deleteMutation.mutate();
	}

	if (classQuery.isLoading) {
		return <div className="card">Loading class...</div>;
	}

	if (classQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load class.{" "}
				{classQuery.error instanceof Error
					? classQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const classData = classQuery.data;
	if (!classData) {
		return <div className="card error-banner">Class data is unavailable.</div>;
	}

	const namespaceOptions = namespacesQuery.data ?? [];
	const hasNamespaceOptions = namespaceOptions.length > 0;
	const namespaceNameById = new Map<number, string>();
	for (const namespace of namespaceOptions) {
		namespaceNameById.set(namespace.id, namespace.name);
	}
	const classNameById = new Map<number, string>();
	for (const item of classesQuery.data ?? []) {
		classNameById.set(item.id, item.name);
	}
	const directRelations = classRelationsQuery.data ?? [];
	const relatedRelations = directRelations
		.map((relation) => ({
			relation,
			relatedClassId:
				relation.from_hubuum_class_id === classId
					? relation.to_hubuum_class_id
					: relation.from_hubuum_class_id,
		}))
		.sort((left, right) =>
			renderClassLabel(left.relatedClassId).localeCompare(
				renderClassLabel(right.relatedClassId),
			),
		);
	const namespaceLabel =
		namespaceNameById.get(classData.namespace.id) ?? classData.namespace.name;
	const hasNamespaceSelection = namespaceOptions.some(
		(namespace) => String(namespace.id) === namespaceId,
	);
	const schemaPreview = stringifyJsonSchema(classData.json_schema);
	const schemaSummary =
		classData.json_schema === undefined
			? []
			: summarizeJsonDocument(classData.json_schema);

	function renderClassLabel(relatedClassId: number) {
		const relatedClassName = classNameById.get(relatedClassId);
		return relatedClassName ?? "Class";
	}

	return (
		<section className="stack">
			<form
				className="card stack"
				onSubmit={onSubmit}
				onKeyDownCapture={onSubmitShortcut}
			>
				<div className="object-meta-strip">
					<div className="object-meta-item">
						<span className="object-meta-label">Validation</span>
						<span className="object-meta-value">
							{classData.validate_schema ? "Enabled" : "Disabled"}
						</span>
					</div>
					<div className="object-meta-item">
						<span className="object-meta-label">Objects</span>
						<span className="object-meta-value">
							<Link href={`/objects?classId=${classId}`}>
								View objects →
							</Link>
						</span>
					</div>
					<div className="object-meta-item">
						<span className="object-meta-label">Created</span>
						<span className="object-meta-value">
							{formatTimestamp(classData.created_at)}
						</span>
					</div>
					<div className="object-meta-item">
						<span className="object-meta-label">Updated</span>
						<span className="object-meta-value">
							{formatTimestamp(classData.updated_at)}
						</span>
					</div>
				</div>

				<div className="object-detail-list">
					<section
						className={`object-detail-row${editingFields.includes("name") ? " is-editing" : ""}`}
					>
						<div className="object-detail-label">Name</div>
						<div className="object-detail-body">
							{editingFields.includes("name") ? (
								<label className="control-field">
									<span className="sr-only">Class name</span>
									<input
										required
										value={name}
										onChange={(event) => setName(event.target.value)}
									/>
								</label>
							) : (
								<button
									type="button"
									className="object-inline-edit"
									onClick={() => toggleFieldEditing("name", classData)}
								>
									<span className="object-detail-value">
										{renderFieldText(classData.name)}
									</span>
									<span className="object-inline-edit-icon">
										<InlineEditIcon />
									</span>
								</button>
							)}
						</div>
						<div className="object-detail-row-actions">
							{editingFields.includes("name") ? (
								<button
									type="button"
									className="ghost"
									onClick={() => toggleFieldEditing("name", classData)}
								>
									Cancel
								</button>
							) : null}
						</div>
					</section>

					<section
						className={`object-detail-row${editingFields.includes("description") ? " is-editing" : ""}`}
					>
						<div className="object-detail-label">Description</div>
						<div className="object-detail-body">
							{editingFields.includes("description") ? (
								<label className="control-field">
									<span className="sr-only">Class description</span>
									<input
										required
										value={description}
										onChange={(event) => setDescription(event.target.value)}
									/>
								</label>
							) : (
								<button
									type="button"
									className="object-inline-edit"
									onClick={() => toggleFieldEditing("description", classData)}
								>
									<span className="object-detail-value">
										{renderFieldText(classData.description ?? "")}
									</span>
									<span className="object-inline-edit-icon">
										<InlineEditIcon />
									</span>
								</button>
							)}
						</div>
						<div className="object-detail-row-actions">
							{editingFields.includes("description") ? (
								<button
									type="button"
									className="ghost"
									onClick={() => toggleFieldEditing("description", classData)}
								>
									Cancel
								</button>
							) : null}
						</div>
					</section>

					<section
						className={`object-detail-row${editingFields.includes("namespace") ? " is-editing" : ""}`}
					>
						<div className="object-detail-label">Namespace</div>
						<div className="object-detail-body">
							{editingFields.includes("namespace") ? (
								<div className="control-field">
									<label htmlFor="class-detail-namespace" className="sr-only">
										Namespace
									</label>
									{hasNamespaceOptions ? (
										<select
											id="class-detail-namespace"
											required
											value={hasNamespaceSelection ? namespaceId : ""}
											onChange={(event) => setNamespaceId(event.target.value)}
										>
											{!hasNamespaceSelection ? (
												<option value="">Select a namespace...</option>
											) : null}
											{namespaceOptions.map((namespace) => (
												<option key={namespace.id} value={namespace.id}>
													{namespace.name}
												</option>
											))}
										</select>
									) : (
										<input
											id="class-detail-namespace"
											required
											type="number"
											min={1}
											value={namespaceId}
											onChange={(event) => setNamespaceId(event.target.value)}
											placeholder={
												namespacesQuery.isLoading
													? "Loading namespaces..."
													: "Enter namespace ID"
											}
											disabled={namespacesQuery.isLoading}
										/>
									)}
								</div>
							) : (
								<button
									type="button"
									className="object-inline-edit"
									onClick={() => toggleFieldEditing("namespace", classData)}
								>
									<span className="object-detail-value">
										{namespaceLabel}
									</span>
									<span className="object-inline-edit-icon">
										<InlineEditIcon />
									</span>
								</button>
							)}
						</div>
						<div className="object-detail-row-actions">
							{editingFields.includes("namespace") ? (
								<button
									type="button"
									className="ghost"
									onClick={() => toggleFieldEditing("namespace", classData)}
								>
									Cancel
								</button>
							) : null}
						</div>
					</section>

					<section
						className={`object-detail-row${editingFields.includes("validate_schema") ? " is-editing" : ""}`}
					>
						<div className="object-detail-label">Schema validation</div>
						<div className="object-detail-body">
							{editingFields.includes("validate_schema") ? (
								<label className="control-check">
									<input
										type="checkbox"
										checked={validateSchema}
										onChange={(event) =>
											setValidateSchema(event.target.checked)
										}
									/>
									<span>Validate objects against JSON schema</span>
								</label>
							) : (
								<button
									type="button"
									className="object-inline-edit"
									onClick={() =>
										toggleFieldEditing("validate_schema", classData)
									}
								>
									<span className="object-detail-value">
										{classData.validate_schema ? "Enabled" : "Disabled"}
									</span>
									<span className="object-inline-edit-icon">
										<InlineEditIcon />
									</span>
								</button>
							)}
						</div>
						<div className="object-detail-row-actions">
							{editingFields.includes("validate_schema") ? (
								<button
									type="button"
									className="ghost"
									onClick={() =>
										toggleFieldEditing("validate_schema", classData)
									}
								>
									Cancel
								</button>
							) : null}
						</div>
					</section>

					<section
						className={`object-detail-row object-detail-row--data${editingFields.includes("json_schema") ? " is-editing" : ""}`}
					>
						<div className="object-detail-label">JSON schema</div>
						<div className="object-detail-body">
							{editingFields.includes("json_schema") ? (
								<JsonEditor
									id="class-detail-json-schema"
									label="JSON schema (optional)"
									value={jsonSchemaInput}
									onChange={setJsonSchemaInput}
									placeholder='{"type":"object","properties":{"name":{"type":"string"}}}'
									mode="schema"
									rows={8}
									helperText="Use a JSON Schema object for object validation preview and backend enforcement."
								/>
							) : classData.json_schema === undefined ? (
								<div className="muted">No JSON schema defined.</div>
							) : (
								<div className="object-json-preview">
									{schemaSummary.length > 0 ? (
										<ul className="object-json-summary">
											{schemaSummary.map((item) => (
												<li key={item}>{item}</li>
											))}
										</ul>
									) : null}
									<pre
										className={`object-json-code${isSchemaExpanded ? " is-expanded" : ""}`}
									>
										{schemaPreview}
									</pre>
								</div>
							)}
						</div>
						<div className="object-detail-row-actions">
							{!editingFields.includes("json_schema") &&
							classData.json_schema !== undefined ? (
								<button
									type="button"
									className="ghost"
									onClick={() => setSchemaExpanded((current) => !current)}
								>
									{isSchemaExpanded ? "Collapse" : "Expand"}
								</button>
							) : null}
							{editingFields.includes("json_schema") ? null : (
								<button
									type="button"
									className="ghost"
									onClick={() => toggleFieldEditing("json_schema", classData)}
								>
									Edit
								</button>
							)}
						</div>
					</section>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{namespacesQuery.isError ? (
					<div className="muted">
						Could not load namespaces automatically. Manual namespace ID input
						is enabled.
					</div>
				) : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions form-actions--spread">
					{hasActiveEdits ? (
						<div className="form-actions">
							<button type="submit" disabled={updateMutation.isPending}>
								{updateMutation.isPending ? "Saving..." : "Save changes"}
							</button>
							<button
								type="button"
								className="ghost"
								onClick={cancelActiveEdits}
								disabled={updateMutation.isPending}
							>
								Cancel
							</button>
						</div>
					) : (
						<div />
					)}
					{hasActiveEdits ? null : (
						<button
							type="button"
							className="danger"
							onClick={onDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete class"}
						</button>
					)}
				</div>
			</form>

			<RemoteInvocationsPanel
				namespaceId={classData.namespace.id}
				subject={{ type: "class", class_id: classId }}
				subjectLabel={`class "${classData.name}"`}
				subjectType="class"
			/>

			<ResourceActivityPanel
				scope={{ type: "class", classId }}
				title="Class audit and history"
			/>

			<section className="card stack">
				{classRelationsQuery.isLoading ? (
					<div className="muted">Loading direct class relations...</div>
				) : null}
				{classRelationsQuery.isError ? (
					<div className="error-banner">
						Failed to load class relations.{" "}
						{classRelationsQuery.error instanceof Error
							? classRelationsQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!classRelationsQuery.isLoading && !classRelationsQuery.isError ? (
					<>
						<div className="relations-toolbar">
							<div className="relations-toolbar-meta">
								<h3 className="relations-title">
									Relations: {directRelations.length}
								</h3>
							</div>
							<Link
								className="link-chip"
								href={`/relations/classes?classId=${classId}`}
							>
								Open relations
							</Link>
						</div>

						{directRelations.length === 0 ? (
							<EmptyState
								title="No directly connected classes yet."
								description="Create a class relation to connect this class with another class."
								action={
									<Link
										className="link-chip"
										href={`/relations/classes?classId=${classId}`}
									>
										Open relations
									</Link>
								}
							/>
						) : (
							<p>
								{relatedRelations.map(({ relation, relatedClassId }, index) => (
									<span key={relation.id}>
										{index > 0 ? ", " : null}
										<Link href={`/classes/${relatedClassId}`}>
											{renderClassLabel(relatedClassId)}
										</Link>
									</span>
								))}
							</p>
						)}
						{classesQuery.isError ? (
							<div className="muted">
								Could not load class names automatically. Showing IDs instead.
							</div>
						) : null}
					</>
				) : null}
			</section>
		</section>
	);
}
