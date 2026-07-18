"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useMemo,
	useState,
} from "react";

import { fetchClassObjectSamples } from "@/lib/api/class-objects";
import {
	type ComputedFieldDraft,
	type ComputedFieldScope,
	type ComputedOperationType,
	createComputedField,
	definitionRequestFromDraft,
	deleteComputedField,
	draftFromDefinition,
	EMPTY_COMPUTED_FIELD_DRAFT,
	fetchPersonalComputedFields,
	fetchSharedComputedFields,
	pathsFromText,
	previewComputedField,
	rebuildSharedComputedFields,
	updateComputedField,
} from "@/lib/api/computed-fields";
import type {
	ClassComputationState,
	ComputedFieldDefinition,
	ComputedFieldPreviewResponse,
	ComputedResultType,
} from "@/lib/api/generated/models";
import {
	arrayItemCount,
	COMPUTED_OPERATIONS,
	fieldForJsonPointer,
	jsonPointerFromFieldPath,
	operationCompatibility,
	pathsToText,
	readJsonPointer,
	recommendedResultType,
	resultTypesForOperation,
	slugifyComputedFieldKey,
	sortDiscoveredJsonFields,
} from "@/lib/computed-field-editor";
import { useConfirm } from "@/lib/confirm-context";
import {
	type DiscoveredJsonField,
	discoverJsonFields,
} from "@/lib/json-field-discovery";

const RESULT_TYPE_LABELS: Record<ComputedResultType, string> = {
	string: "Text",
	number: "Number",
	integer: "Integer",
	boolean: "True / false",
	object: "Object",
	array: "Array",
};

const EDITOR_STEPS = [
	{ id: "target", label: "Target", hint: "Class and visibility" },
	{ id: "inputs", label: "Inputs", hint: "Choose source fields" },
	{ id: "calculation", label: "Calculation", hint: "Combine the inputs" },
	{ id: "details", label: "Details", hint: "Name and describe" },
	{ id: "preview", label: "Preview", hint: "Test and save" },
] as const;

type EditorStep = (typeof EDITOR_STEPS)[number]["id"];

type ComputedFieldsPanelProps = {
	classId: number;
	className: string;
	collectionName: string;
	jsonSchema?: unknown;
};

type EditorContext = {
	definition: ComputedFieldDefinition | null;
	scope: ComputedFieldScope;
};

function cloneEmptyDraft(): ComputedFieldDraft {
	return { ...EMPTY_COMPUTED_FIELD_DRAFT };
}

function operationSummary(definition: ComputedFieldDefinition): string {
	const operation = definition.operation as {
		paths?: unknown;
		type?: unknown;
	};
	const operationOption = COMPUTED_OPERATIONS.find(
		(option) => option.value === operation.type,
	);
	const type =
		operationOption?.label ??
		(typeof operation.type === "string"
			? operation.type.replaceAll("_", " ")
			: "Operation");
	const pathCount = Array.isArray(operation.paths) ? operation.paths.length : 0;
	return `${type} · ${pathCount} input${pathCount === 1 ? "" : "s"}`;
}

function formatPreview(preview: ComputedFieldPreviewResponse): string {
	if (preview.error) {
		return `${preview.error.code}: ${preview.error.message}`;
	}
	const formatted = JSON.stringify(preview.value, null, 2);
	return formatted ?? String(preview.value);
}

function formatJsonValue(value: unknown): string {
	if (value === undefined) return "Missing";
	const formatted = JSON.stringify(value);
	return formatted ?? String(value);
}

function fieldDetail(field: DiscoveredJsonField, sampleCount: number): string {
	const types = field.types.length ? field.types.join(" / ") : "unknown";
	if (field.source === "schema") return `${types} · class schema`;
	return `${types} · sampled in ${field.observedIn} of ${sampleCount}`;
}

function pathsError(paths: readonly string[]): string | null {
	if (paths.length === 0) return "Choose at least one input field.";
	if (paths.length > 16) return "Choose no more than 16 input fields.";
	if (new Set(paths).size !== paths.length)
		return "Input paths must be unique.";
	const invalid = paths.find((path) => path !== "" && !path.startsWith("/"));
	return invalid ? `JSON Pointer must start with “/”: ${invalid}` : null;
}

function EditorContinueBar({
	disabled = false,
	nextLabel,
	onContinue,
	summary,
	title,
}: {
	disabled?: boolean;
	nextLabel: string;
	onContinue: () => void;
	summary: string;
	title: string;
}) {
	return (
		<div className="card export-target-continue-bar">
			<div className="stack action-card-header">
				<strong>{title}</strong>
				<span className="muted">{summary}</span>
			</div>
			<button type="button" onClick={onContinue} disabled={disabled}>
				Continue to {nextLabel.toLocaleLowerCase()}
			</button>
		</div>
	);
}

type ScopeCardProps = {
	classId: number;
	definitions: ComputedFieldDefinition[];
	editorOpen: boolean;
	isLoading: boolean;
	loadError: Error | null;
	onCreate: () => void;
	onEdit: (definition: ComputedFieldDefinition) => void;
	scope: ComputedFieldScope;
	state?: ClassComputationState;
};

function ComputedScopeCard({
	classId,
	definitions,
	editorOpen,
	isLoading,
	loadError,
	onCreate,
	onEdit,
	scope,
	state,
}: ScopeCardProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const queryKey = ["computed-fields", scope, classId];

	const deleteMutation = useMutation({
		mutationFn: (definition: ComputedFieldDefinition) =>
			deleteComputedField(scope, definition.class_id, definition),
		onSuccess: async (_result, definition) => {
			await queryClient.invalidateQueries({
				queryKey: ["computed-fields", scope, definition.class_id],
			});
			await queryClient.invalidateQueries({
				queryKey: ["objects", definition.class_id],
			});
		},
	});

	const rebuildMutation = useMutation({
		mutationFn: () => rebuildSharedComputedFields(classId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey });
		},
	});

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
				<button type="button" onClick={onCreate} disabled={editorOpen}>
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
						disabled={rebuildMutation.isPending || !state}
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
							onClick={() => onEdit(definition)}
							disabled={editorOpen}
						>
							Edit
						</button>
						<button
							className="danger"
							type="button"
							onClick={() => onDelete(definition)}
							disabled={deleteMutation.isPending || editorOpen}
						>
							Delete
						</button>
					</div>
				</div>
			))}
		</article>
	);
}

type ComputedFieldEditorProps = ComputedFieldsPanelProps & {
	definition: ComputedFieldDefinition | null;
	existingDefinitions: ComputedFieldDefinition[];
	onClose: () => void;
	scope: ComputedFieldScope;
};

function ComputedFieldEditor({
	classId,
	className,
	collectionName,
	definition,
	existingDefinitions,
	jsonSchema,
	onClose,
	scope,
}: ComputedFieldEditorProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const initialDraft = useMemo(
		() => (definition ? draftFromDefinition(definition) : cloneEmptyDraft()),
		[definition],
	);
	const [draft, setDraft] = useState<ComputedFieldDraft>(initialDraft);
	const [activeStep, setActiveStep] = useState<EditorStep>("target");
	const [fieldSearch, setFieldSearch] = useState("");
	const [arrayIndexes, setArrayIndexes] = useState<Record<string, string[]>>(
		{},
	);
	const [keyWasEdited, setKeyWasEdited] = useState(Boolean(definition));
	const [previewMode, setPreviewMode] = useState<"object" | "data">("object");
	const [previewObjectId, setPreviewObjectId] = useState("");
	const [previewObjectSearch, setPreviewObjectSearch] = useState("");
	const [previewData, setPreviewData] = useState("{}");
	const [preview, setPreview] = useState<ComputedFieldPreviewResponse | null>(
		null,
	);
	const [formError, setFormError] = useState<string | null>(null);

	const objectSamplesQuery = useQuery({
		queryKey: ["computed-field-object-options", classId],
		queryFn: () => fetchClassObjectSamples(classId),
		staleTime: 60_000,
	});
	const objects = objectSamplesQuery.data ?? [];
	const schemaFields = useMemo(
		() => discoverJsonFields(jsonSchema, []),
		[jsonSchema],
	);
	const usesSchemaFields = schemaFields.length > 0;
	const discoveredFields = useMemo(
		() =>
			usesSchemaFields
				? schemaFields
				: discoverJsonFields(
						undefined,
						objects.map((objectItem) => objectItem.data),
					),
		[objects, schemaFields, usesSchemaFields],
	);
	const matchingFields = useMemo(() => {
		const normalized = fieldSearch.trim().toLocaleLowerCase();
		const sortedFields = sortDiscoveredJsonFields(discoveredFields);
		if (!normalized) return sortedFields;
		return sortedFields.filter((field) =>
			`${field.label} ${field.types.join(" ")}`
				.toLocaleLowerCase()
				.includes(normalized),
		);
	}, [discoveredFields, fieldSearch]);
	const paths = useMemo(
		() => pathsFromText(draft.pathsText),
		[draft.pathsText],
	);
	const selectedFields = useMemo(
		() => paths.map((path) => fieldForJsonPointer(discoveredFields, path)),
		[discoveredFields, paths],
	);
	const availableFields = useMemo(
		() =>
			matchingFields.filter((field) => {
				const pointer = jsonPointerFromFieldPath(
					field.path,
					arrayIndexes[JSON.stringify(field.path)],
				);
				return pointer === null || !paths.includes(pointer);
			}),
		[arrayIndexes, matchingFields, paths],
	);
	const rootMatchesSearch = "document root whole object"
		.toLocaleLowerCase()
		.includes(fieldSearch.trim().toLocaleLowerCase());
	const rootAvailable = rootMatchesSearch && !paths.includes("");
	const inputError = pathsError(paths);
	const compatibility = operationCompatibility(
		draft.operationType,
		paths,
		selectedFields,
	);
	const allowedResultTypes = resultTypesForOperation(draft.operationType);
	const duplicateKey = existingDefinitions.some(
		(existing) =>
			existing.id !== definition?.id && existing.key === draft.key.trim(),
	);
	const keyValid = /^[a-z][a-z0-9_]{0,63}$/.test(draft.key.trim());
	const detailsReady = keyValid && Boolean(draft.label.trim()) && !duplicateKey;
	const calculationReady =
		compatibility.compatible && allowedResultTypes.includes(draft.resultType);
	const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);

	useEffect(() => {
		if (!isDirty) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [isDirty]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const request = definitionRequestFromDraft(draft);
			if (duplicateKey)
				throw new Error("A field with this key already exists.");
			if (!definition) return createComputedField(scope, classId, request);
			return updateComputedField(scope, classId, definition.id, {
				...request,
				expected_revision: definition.revision,
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["computed-fields", scope, classId],
			});
			await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
			onClose();
		},
		onError: (error) => {
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to save computed field.",
			);
		},
	});

	const previewMutation = useMutation({
		mutationFn: async () => {
			const computedDefinition = definitionRequestFromDraft(draft);
			if (previewMode === "object") {
				const objectId = Number.parseInt(previewObjectId, 10);
				if (!Number.isInteger(objectId) || objectId < 1) {
					throw new Error("Choose an object for preview.");
				}
				return previewComputedField(scope, classId, {
					definition: computedDefinition,
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
				definition: computedDefinition,
			});
		},
		onSuccess: setPreview,
	});

	function updatePaths(nextPaths: string[]) {
		const nextSelectedFields = nextPaths.map((path) =>
			fieldForJsonPointer(discoveredFields, path),
		);
		setDraft((current) => ({
			...current,
			pathsText: pathsToText(nextPaths),
			resultType: recommendedResultType(
				current.operationType,
				nextSelectedFields,
				current.resultType,
			),
		}));
		setPreview(null);
	}

	function addField(field: DiscoveredJsonField) {
		if (paths.length >= 16) return;
		const key = JSON.stringify(field.path);
		const pointer = jsonPointerFromFieldPath(field.path, arrayIndexes[key]);
		if (pointer === null || paths.includes(pointer)) return;
		updatePaths([...paths, pointer]);
		const indexCount = arrayItemCount(field.path);
		if (indexCount > 0) {
			setArrayIndexes((current) => ({
				...current,
				[key]: Array(indexCount).fill(""),
			}));
		}
	}

	function movePath(index: number, direction: -1 | 1) {
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= paths.length) return;
		const nextPaths = [...paths];
		[nextPaths[index], nextPaths[nextIndex]] = [
			nextPaths[nextIndex],
			nextPaths[index],
		];
		updatePaths(nextPaths);
	}

	function selectOperation(operationType: ComputedOperationType) {
		setDraft((current) => ({
			...current,
			operationType,
			resultType: recommendedResultType(
				operationType,
				selectedFields,
				current.resultType,
			),
		}));
		setPreview(null);
	}

	function stepEnabled(step: EditorStep): boolean {
		if (step === "target" || step === "inputs") return true;
		if (step === "calculation") return !inputError;
		if (step === "details") return !inputError && calculationReady;
		return !inputError && calculationReady && detailsReady;
	}

	function handleStepKeyDown(
		event: ReactKeyboardEvent<HTMLButtonElement>,
		step: EditorStep,
	) {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
			return;
		}
		event.preventDefault();
		const enabled = EDITOR_STEPS.filter((item) => stepEnabled(item.id));
		const currentIndex = enabled.findIndex((item) => item.id === step);
		const next =
			event.key === "Home"
				? enabled[0]
				: event.key === "End"
					? enabled.at(-1)
					: enabled[
							(currentIndex +
								(event.key === "ArrowRight" ? 1 : -1) +
								enabled.length) %
								enabled.length
						];
		if (!next) return;
		setActiveStep(next.id);
		requestAnimationFrame(() =>
			document.getElementById(`computed-field-tab-${next.id}`)?.focus(),
		);
	}

	async function requestClose() {
		if (!isDirty) {
			onClose();
			return;
		}
		const accepted = await confirm({
			title: "Discard computed field changes?",
			description: "The unsaved definition will be lost.",
			confirmLabel: "Discard changes",
			tone: "danger",
		});
		if (accepted) onClose();
	}

	const filteredPreviewObjects = objects.filter((objectItem) => {
		const query = previewObjectSearch.trim().toLocaleLowerCase();
		return (
			!query ||
			`${objectItem.name} ${objectItem.id}`.toLocaleLowerCase().includes(query)
		);
	});
	const selectedPreviewObject = objects.find(
		(objectItem) => String(objectItem.id) === previewObjectId,
	);
	let previewDocument: unknown = selectedPreviewObject?.data;
	let previewDataError: string | null = null;
	if (previewMode === "data") {
		try {
			previewDocument = JSON.parse(previewData);
			if (
				typeof previewDocument !== "object" ||
				previewDocument === null ||
				Array.isArray(previewDocument)
			) {
				previewDataError = "Preview data must be a JSON object.";
			}
		} catch {
			previewDataError = "Preview data must be valid JSON.";
		}
	}
	const previewSourceReady =
		previewMode === "object"
			? Boolean(selectedPreviewObject)
			: !previewDataError;

	return (
		<article className="card stack panel-card computed-field-editor">
			<header className="relations-toolbar">
				<div className="stack action-card-header">
					<p className="eyebrow">{scope} computed field</p>
					<h3>
						{definition
							? `Edit ${definition.label}`
							: `New ${scope} computed field`}
					</h3>
					<span
						className={isDirty ? "save-state save-state--dirty" : "save-state"}
					>
						{isDirty ? "Unsaved changes" : "No changes yet"}
					</span>
				</div>
				<button className="ghost" type="button" onClick={requestClose}>
					Close editor
				</button>
			</header>

			<div
				className="export-template-editor-tabs computed-field-editor-tabs"
				role="tablist"
				aria-label="Computed field editor sections"
			>
				{EDITOR_STEPS.map((step) => {
					const enabled = stepEnabled(step.id);
					return (
						<button
							key={step.id}
							type="button"
							id={`computed-field-tab-${step.id}`}
							role="tab"
							aria-selected={activeStep === step.id}
							aria-controls={`computed-field-panel-${step.id}`}
							tabIndex={activeStep === step.id ? 0 : -1}
							className={activeStep === step.id ? "is-active" : ""}
							disabled={!enabled}
							onClick={() => setActiveStep(step.id)}
							onKeyDown={(event) => handleStepKeyDown(event, step.id)}
						>
							<span>{step.label}</span>
							<small>
								{enabled ? step.hint : "Complete the previous step"}
							</small>
						</button>
					);
				})}
			</div>

			{activeStep === "target" ? (
				<div
					id="computed-field-panel-target"
					className="stack"
					role="tabpanel"
					aria-labelledby="computed-field-tab-target"
				>
					<div className="computed-field-target-grid">
						<div className="summary-pill">
							<span>Collection</span>
							<strong>{collectionName}</strong>
						</div>
						<div className="summary-pill">
							<span>Class</span>
							<strong>{className}</strong>
							<small>Class #{classId}</small>
						</div>
						<div className="summary-pill">
							<span>Visibility</span>
							<strong>{scope === "shared" ? "Shared" : "Personal"}</strong>
						</div>
					</div>
					<p className="muted">
						The target comes from the class workspace and cannot be changed
						while editing.{" "}
						{scope === "shared"
							? "Shared values are visible to every reader and materialized by background tasks."
							: "Personal values are visible only to you."}
					</p>
					<EditorContinueBar
						title="Target ready"
						summary={`${collectionName} · ${className} · ${scope}`}
						nextLabel="Inputs"
						onContinue={() => setActiveStep("inputs")}
					/>
				</div>
			) : null}

			{activeStep === "inputs" ? (
				<div
					id="computed-field-panel-inputs"
					className="stack"
					role="tabpanel"
					aria-labelledby="computed-field-tab-inputs"
				>
					<div className="computed-field-input-layout">
						<section
							className="stack computed-field-palette"
							aria-labelledby="available-inputs-heading"
						>
							<div className="computed-transfer-section-header">
								<div className="stack action-card-header">
									<h4 id="available-inputs-heading">Available fields</h4>
									<p className="muted">
										{usesSchemaFields
											? "Discovered from the class schema."
											: objectSamplesQuery.isFetching
												? "Inspecting up to 100 objects because the class has no discoverable schema fields…"
												: `Discovered by inspecting ${objects.length} object${objects.length === 1 ? "" : "s"}.`}
									</p>
								</div>
								<span className="computed-transfer-count">
									{availableFields.length + (rootAvailable ? 1 : 0)} available
								</span>
							</div>
							<label className="control-field">
								<span>Find fields</span>
								<input
									type="search"
									value={fieldSearch}
									onChange={(event) => setFieldSearch(event.target.value)}
									placeholder="Name or type"
								/>
							</label>
							{objectSamplesQuery.isError && !usesSchemaFields ? (
								<div className="error-banner" role="alert">
									{objectSamplesQuery.error.message}
								</div>
							) : null}
							{availableFields.length || rootAvailable ? (
								<ul className="template-data-field-list computed-field-palette-list">
									{rootAvailable ? (
										<li className="computed-field-palette-item computed-field-root-item">
											<div className="template-data-field">
												<code>Document root</code>
												<small>The complete object data document</small>
											</div>
											<button
												type="button"
												className="ghost computed-transfer-button"
												aria-label="Add document root to selected inputs"
												title="Add to selected inputs"
												onClick={() => updatePaths([...paths, ""])}
												disabled={paths.length >= 16}
											>
												<span aria-hidden="true">→</span>
											</button>
										</li>
									) : null}
									{availableFields.map((field) => {
										const key = JSON.stringify(field.path);
										const arrayEntries = field.path.flatMap(
											(segment, pathIndex) =>
												segment === "[#]"
													? [
															{
																id: JSON.stringify(
																	field.path.slice(0, pathIndex + 1),
																),
															},
														]
													: [],
										);
										const indexCount = arrayItemCount(field.path);
										const indexes =
											arrayIndexes[key] ?? Array(indexCount).fill("");
										const pointer = jsonPointerFromFieldPath(
											field.path,
											indexes,
										);
										return (
											<li key={key} className="computed-field-palette-item">
												<div className="template-data-field">
													<code>{field.label}</code>
													<small>{fieldDetail(field, objects.length)}</small>
												</div>
												{indexCount > 0 ? (
													<div className="computed-array-indexes">
														{arrayEntries.map((entry, index) => (
															<label key={entry.id} className="control-field">
																<span>Array index {index + 1}</span>
																<input
																	type="number"
																	min={0}
																	step={1}
																	value={indexes[index] ?? ""}
																	onChange={(event) => {
																		const next = [...indexes];
																		next[index] = event.target.value;
																		setArrayIndexes((current) => ({
																			...current,
																			[key]: next,
																		}));
																	}}
																/>
															</label>
														))}
													</div>
												) : null}
												<button
													type="button"
													className="ghost computed-transfer-button"
													aria-label={`Add ${field.label} to selected inputs`}
													title="Add to selected inputs"
													onClick={() => addField(field)}
													disabled={pointer === null || paths.length >= 16}
												>
													<span aria-hidden="true">→</span>
												</button>
											</li>
										);
									})}
								</ul>
							) : objectSamplesQuery.isFetching && !usesSchemaFields ? (
								<p className="muted">Looking for data fields…</p>
							) : matchingFields.length > 0 || paths.includes("") ? (
								<div className="empty-state">
									All matching fields are already selected.
								</div>
							) : (
								<div className="empty-state">
									No matching fields were found.
								</div>
							)}
						</section>

						<section
							className="stack computed-field-selected"
							aria-labelledby="selected-inputs-heading"
						>
							<div className="computed-transfer-section-header">
								<div className="stack action-card-header">
									<h4 id="selected-inputs-heading">Selected inputs</h4>
									<p className="muted">Operands are evaluated in this order.</p>
								</div>
								<span className="computed-transfer-count">
									{paths.length} / 16 selected
								</span>
							</div>
							{paths.length ? (
								<ol className="computed-selected-input-list">
									{paths.map((path, index) => {
										const field = selectedFields[index];
										return (
											<li key={path || "<root>"}>
												<span className="computed-operand-index">
													<span className="sr-only">Operand </span>
													{index + 1}
												</span>
												<div>
													<strong>
														{field?.label ??
															(path === ""
																? "Document root"
																: "Manual pointer")}
													</strong>
													<code>{path === "" ? "<root>" : path}</code>
												</div>
												<div className="action-row computed-operand-actions">
													<button
														type="button"
														className="ghost icon-button"
														aria-label={`Move ${path || "document root"} up`}
														title="Move up"
														onClick={() => movePath(index, -1)}
														disabled={index === 0}
													>
														↑
													</button>
													<button
														type="button"
														className="ghost icon-button"
														aria-label={`Move ${path || "document root"} down`}
														title="Move down"
														onClick={() => movePath(index, 1)}
														disabled={index === paths.length - 1}
													>
														↓
													</button>
													<button
														type="button"
														className="ghost icon-button"
														aria-label={`Remove ${path || "document root"} from selected inputs`}
														title="Remove from selected inputs"
														onClick={() =>
															updatePaths(
																paths.filter(
																	(_, itemIndex) => itemIndex !== index,
																),
															)
														}
													>
														×
													</button>
												</div>
											</li>
										);
									})}
								</ol>
							) : (
								<div className="empty-state">
									Choose fields from the palette.
								</div>
							)}
							<details className="export-disclosure">
								<summary>
									<span>Advanced JSON Pointer editing</span>
									<small>One pointer per line</small>
								</summary>
								<div className="export-disclosure-body">
									<label className="control-field control-field--wide">
										<span>JSON Pointer paths, one per line</span>
										<textarea
											rows={6}
											value={draft.pathsText}
											onChange={(event) =>
												setDraft((current) => ({
													...current,
													pathsText: event.target.value,
												}))
											}
											placeholder={"/price\n/tax"}
										/>
										<small>
											Use &lt;root&gt; for the complete object data document.
										</small>
									</label>
								</div>
							</details>
						</section>
					</div>
					{inputError ? (
						<div className="error-banner" role="alert">
							{inputError}
						</div>
					) : null}
					<EditorContinueBar
						title={inputError ? "Choose the field inputs" : "Inputs ready"}
						summary={`${paths.length} of 16 inputs selected`}
						nextLabel="Calculation"
						onContinue={() => setActiveStep("calculation")}
						disabled={Boolean(inputError)}
					/>
				</div>
			) : null}

			{activeStep === "calculation" ? (
				<div
					id="computed-field-panel-calculation"
					className="stack"
					role="tabpanel"
					aria-labelledby="computed-field-tab-calculation"
				>
					<fieldset className="stack computed-operation-fieldset">
						<legend>How should the inputs be combined?</legend>
						<div className="computed-operation-grid">
							{COMPUTED_OPERATIONS.map((operation) => {
								const optionCompatibility = operationCompatibility(
									operation.value,
									paths,
									selectedFields,
								);
								return (
									<label
										key={operation.value}
										className={`computed-operation-card${draft.operationType === operation.value ? " is-selected" : ""}`}
									>
										<input
											type="radio"
											name="computed-operation"
											value={operation.value}
											checked={draft.operationType === operation.value}
											onChange={() => selectOperation(operation.value)}
											disabled={!optionCompatibility.compatible}
										/>
										<span>
											<strong>{operation.label}</strong>
											<small>
												{optionCompatibility.reason ?? operation.description}
											</small>
										</span>
									</label>
								);
							})}
						</div>
					</fieldset>
					<label className="control-field computed-result-type">
						<span>Result type</span>
						<select
							value={draft.resultType}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									resultType: event.target.value as ComputedResultType,
								}))
							}
							disabled={allowedResultTypes.length === 1}
						>
							{allowedResultTypes.map((resultType) => (
								<option key={resultType} value={resultType}>
									{RESULT_TYPE_LABELS[resultType]}
								</option>
							))}
						</select>
						<small>
							{allowedResultTypes.length === 1
								? "The selected operation determines this type."
								: "Inferred from the selected inputs; adjust it if needed."}
						</small>
					</label>
					{!compatibility.compatible ? (
						<div className="error-banner" role="alert">
							{compatibility.reason}
						</div>
					) : null}
					<EditorContinueBar
						title={
							calculationReady
								? "Calculation ready"
								: "Choose a compatible calculation"
						}
						summary={`${COMPUTED_OPERATIONS.find((item) => item.value === draft.operationType)?.label ?? draft.operationType} · ${RESULT_TYPE_LABELS[draft.resultType]}`}
						nextLabel="Details"
						onContinue={() => setActiveStep("details")}
						disabled={!calculationReady}
					/>
				</div>
			) : null}

			{activeStep === "details" ? (
				<div
					id="computed-field-panel-details"
					className="stack"
					role="tabpanel"
					aria-labelledby="computed-field-tab-details"
				>
					<div className="grid cols-2">
						<label className="control-field">
							<span>Label</span>
							<input
								required
								value={draft.label}
								onChange={(event) => {
									const label = event.target.value;
									setDraft((current) => ({
										...current,
										label,
										key: keyWasEdited
											? current.key
											: slugifyComputedFieldKey(label),
									}));
								}}
								placeholder="Display name"
							/>
							{!draft.label.trim() ? (
								<small className="field-error">Enter a label.</small>
							) : null}
						</label>
						<label className="control-field">
							<span>Key</span>
							<input
								required
								pattern="[a-z][a-z0-9_]{0,63}"
								value={draft.key}
								onChange={(event) => {
									setKeyWasEdited(true);
									setDraft((current) => ({
										...current,
										key: event.target.value,
									}));
								}}
							/>
							{!keyValid ? (
								<small className="field-error">
									Use a lowercase key beginning with a letter.
								</small>
							) : duplicateKey ? (
								<small className="field-error">
									This {scope} key already exists.
								</small>
							) : (
								<small>Generated from the label until edited.</small>
							)}
						</label>
					</div>
					<label className="control-field control-field--wide">
						<span>Description</span>
						<textarea
							rows={3}
							value={draft.description}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									description: event.target.value,
								}))
							}
							placeholder="Explain what this value represents."
						/>
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
					<EditorContinueBar
						title={detailsReady ? "Details ready" : "Name this computed field"}
						summary={
							draft.label.trim() || "A label and unique key are required"
						}
						nextLabel="Preview"
						onContinue={() => setActiveStep("preview")}
						disabled={!detailsReady}
					/>
				</div>
			) : null}

			{activeStep === "preview" ? (
				<div
					id="computed-field-panel-preview"
					className="stack"
					role="tabpanel"
					aria-labelledby="computed-field-tab-preview"
				>
					<div className="computed-preview-layout">
						<section className="stack">
							<div className="stack action-card-header">
								<h4>Preview source</h4>
								<p className="muted">
									Test against an existing object or advanced sample JSON.
								</p>
							</div>
							<label className="control-field">
								<span>Preview source</span>
								<select
									value={previewMode}
									onChange={(event) => {
										setPreviewMode(event.target.value as "object" | "data");
										setPreview(null);
									}}
								>
									<option value="object">Existing object</option>
									<option value="data">Sample JSON data</option>
								</select>
							</label>
							{previewMode === "object" ? (
								<>
									<label className="control-field">
										<span>Find objects</span>
										<input
											type="search"
											value={previewObjectSearch}
											onChange={(event) =>
												setPreviewObjectSearch(event.target.value)
											}
											placeholder="Name or ID"
										/>
									</label>
									<div className="control-field">
										<label htmlFor="computed-field-preview-object">
											Object
										</label>
										<select
											id="computed-field-preview-object"
											value={previewObjectId}
											onChange={(event) => {
												setPreviewObjectId(event.target.value);
												setPreview(null);
											}}
											disabled={
												objectSamplesQuery.isLoading || objects.length === 0
											}
										>
											<option value="">
												{objectSamplesQuery.isLoading
													? "Loading objects…"
													: objects.length
														? "Choose an object"
														: "No objects in this class"}
											</option>
											{filteredPreviewObjects.map((objectItem) => (
												<option key={objectItem.id} value={objectItem.id}>
													{objectItem.name} (#{objectItem.id})
												</option>
											))}
										</select>
									</div>
								</>
							) : (
								<label className="control-field control-field--wide">
									<span>Sample JSON object</span>
									<textarea
										rows={8}
										value={previewData}
										onChange={(event) => {
											setPreviewData(event.target.value);
											setPreview(null);
										}}
									/>
									{previewDataError ? (
										<small className="field-error">{previewDataError}</small>
									) : null}
								</label>
							)}
						</section>

						<section className="stack">
							<div className="stack action-card-header">
								<h4>Input values</h4>
								<p className="muted">
									Values resolved locally from the selected preview source.
								</p>
							</div>
							{previewSourceReady ? (
								<dl className="computed-preview-values">
									{paths.map((path) => (
										<div key={path || "<root>"}>
											<dt>
												<code>{path || "<root>"}</code>
											</dt>
											<dd>
												{formatJsonValue(
													readJsonPointer(previewDocument, path),
												)}
											</dd>
										</div>
									))}
								</dl>
							) : (
								<div className="empty-state">
									Choose a valid preview source to inspect its values.
								</div>
							)}
						</section>
					</div>
					<div className="action-row">
						<button
							type="button"
							className="ghost"
							onClick={() => previewMutation.mutate()}
							disabled={previewMutation.isPending || !previewSourceReady}
						>
							{previewMutation.isPending ? "Evaluating…" : "Run preview"}
						</button>
						<span className="muted">
							Preview is recommended but not required to save.
						</span>
					</div>
					{previewMutation.isError ? (
						<div className="error-banner" role="alert">
							{previewMutation.error.message}
						</div>
					) : null}
					{preview ? (
						<div
							className={preview.error ? "error-banner" : "success-banner"}
							role="status"
						>
							<strong>Preview result</strong>
							<pre>{formatPreview(preview)}</pre>
						</div>
					) : null}
					{scope === "shared" ? (
						<p className="field-note">
							Saving a shared definition updates the class evaluation revision
							and may queue a background rebuild.
						</p>
					) : null}
					{formError ? (
						<div className="error-banner" role="alert">
							{formError}
						</div>
					) : null}
					<div className="form-actions">
						<button
							type="button"
							onClick={() => {
								setFormError(null);
								saveMutation.mutate();
							}}
							disabled={saveMutation.isPending}
						>
							{saveMutation.isPending ? "Saving…" : "Save field"}
						</button>
						<button className="ghost" type="button" onClick={requestClose}>
							Cancel
						</button>
					</div>
				</div>
			) : null}
		</article>
	);
}

export function ComputedFieldsPanel({
	classId,
	className,
	collectionName,
	jsonSchema,
}: ComputedFieldsPanelProps) {
	const [editor, setEditor] = useState<EditorContext | null>(null);
	const sharedQuery = useQuery({
		queryKey: ["computed-fields", "shared", classId],
		queryFn: () => fetchSharedComputedFields(classId),
	});
	const personalQuery = useQuery({
		queryKey: ["computed-fields", "personal", classId],
		queryFn: () => fetchPersonalComputedFields(classId),
	});
	const sharedDefinitions = sharedQuery.data?.definitions ?? [];
	const personalDefinitions = personalQuery.data ?? [];

	return (
		<section id="computed-fields" className="stack">
			<header className="stack action-card-header">
				<div>
					<p className="eyebrow">Derived data</p>
					<h2>Computed fields</h2>
				</div>
				<p className="muted">
					Build typed values from fields in this class. Computed values appear
					on object reads but cannot be used for backend filtering or sorting.
				</p>
			</header>

			{editor ? (
				<ComputedFieldEditor
					key={`${editor.scope}-${editor.definition?.id ?? "new"}`}
					classId={classId}
					className={className}
					collectionName={collectionName}
					definition={editor.definition}
					existingDefinitions={
						editor.scope === "shared" ? sharedDefinitions : personalDefinitions
					}
					jsonSchema={jsonSchema}
					onClose={() => setEditor(null)}
					scope={editor.scope}
				/>
			) : null}

			<div className="grid cols-2">
				<ComputedScopeCard
					classId={classId}
					definitions={sharedDefinitions}
					editorOpen={Boolean(editor)}
					isLoading={sharedQuery.isLoading}
					loadError={sharedQuery.error}
					onCreate={() => setEditor({ definition: null, scope: "shared" })}
					onEdit={(definition) => setEditor({ definition, scope: "shared" })}
					scope="shared"
					state={sharedQuery.data?.state}
				/>
				<ComputedScopeCard
					classId={classId}
					definitions={personalDefinitions}
					editorOpen={Boolean(editor)}
					isLoading={personalQuery.isLoading}
					loadError={personalQuery.error}
					onCreate={() => setEditor({ definition: null, scope: "personal" })}
					onEdit={(definition) => setEditor({ definition, scope: "personal" })}
					scope="personal"
				/>
			</div>
		</section>
	);
}
