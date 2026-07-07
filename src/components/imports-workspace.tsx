"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
	FormEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamGroups,
	getApiV1Collections,
} from "@/lib/api/generated/client";
import type { Group, Collection } from "@/lib/api/generated/models";
import { createImportTask, type ImportRequest } from "@/lib/api/tasking";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
	getDuplicateCollectionNames,
} from "@/lib/collection-hierarchy";
import {
	buildImportSubmissionPayload,
	getImportCollectionSuggestion,
	type CollectionMode,
} from "@/lib/import-payload";

type ImportSummary = {
	totalItems: number;
	sections: Array<{
		name: string;
		count: number;
	}>;
};

type ImportFilePayload = ImportRequest & Record<string, unknown>;

type ImportsWorkspaceProps = {
	canCreateCollections: boolean;
};

type HintKey =
	| "import-file"
	| "dry-run"
	| "atomicity"
	| "collision-policy"
	| "collection-handling"
	| "target-collection"
	| "collection-description"
	| "permission-policy"
	| "delegate-group"
	| "idempotency-key";

type FilePermissionGroupValidation =
	| { kind: "valid"; groupNames: string[] }
	| { kind: "missing"; groupNames: string[] }
	| { kind: "unchecked"; reason: string };

function parsePositiveInteger(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function summarizeImport(payload: ImportRequest): ImportSummary {
	const sectionNames = [
		"collections",
		"classes",
		"objects",
		"class_relations",
		"object_relations",
		"collection_permissions",
	] as const;
	const sections = sectionNames.map((name) => ({
		name,
		count: Array.isArray(payload.graph?.[name])
			? payload.graph[name].length
			: 0,
	}));

	return {
		totalItems: sections.reduce((sum, section) => sum + section.count, 0),
		sections,
	};
}

function normalizeImportPayload(payload: unknown): ImportFilePayload {
	if (!payload || typeof payload !== "object") {
		throw new Error("Import file must contain a JSON object.");
	}

	const candidate = payload as Record<string, unknown>;
	if (candidate.version !== 1) {
		throw new Error("Import file must declare version 1.");
	}
	if (
		!candidate.graph ||
		typeof candidate.graph !== "object" ||
		Array.isArray(candidate.graph)
	) {
		throw new Error("Import file must include a graph object.");
	}

	return candidate as ImportFilePayload;
}

function getFilePermissionGroupNames(payload: ImportRequest): string[] {
	const groupNames = new Set<string>();

	for (const permission of payload.graph.collection_permissions ?? []) {
		const groupname = permission.group_key.groupname?.trim();
		if (groupname) {
			groupNames.add(groupname);
		}
	}

	return Array.from(groupNames).sort((left, right) => left.localeCompare(right));
}

async function fetchGroups(): Promise<Group[]> {
	const response = await getApiV1IamGroups(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load groups."),
		);
	}

	return response.data;
}

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections({ limit: 250 }, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}

	return response.data;
}

export function ImportsWorkspace({
	canCreateCollections,
}: ImportsWorkspaceProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [fileName, setFileName] = useState("");
	const [parsedImport, setParsedImport] = useState<ImportFilePayload | null>(
		null,
	);
	const [parseError, setParseError] = useState<string | null>(null);
	const [dryRun, setDryRun] = useState(false);
	const [atomicity, setAtomicity] = useState<"strict" | "best_effort">(
		"strict",
	);
	const [collisionPolicy, setCollisionPolicy] = useState<"abort" | "overwrite">(
		"abort",
	);
	const [permissionPolicy, setPermissionPolicy] = useState<
		"abort" | "continue"
	>("abort");
	const [collectionMode, setCollectionMode] = useState<CollectionMode>(
		canCreateCollections ? "file" : "existing_override",
	);
	const [targetCollectionName, setTargetCollectionName] = useState("");
	const [targetCollectionDescription, setTargetCollectionDescription] =
		useState("");
	const [delegateGroupName, setDelegateGroupName] = useState("");
	const [idempotencyKey, setIdempotencyKey] = useState("");
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [taskLookupInput, setTaskLookupInput] = useState("");
	const [activeHint, setActiveHint] = useState<HintKey | null>(null);

	const importSummary = useMemo(
		() => (parsedImport ? summarizeImport(parsedImport) : null),
		[parsedImport],
	);
	const groupsQuery = useQuery({
		queryKey: ["groups", "imports-form"],
		queryFn: fetchGroups,
		enabled: canCreateCollections && collectionMode !== "existing_override",
	});
	const collectionsQuery = useQuery({
		queryKey: ["collections", "imports-form"],
		queryFn: fetchCollections,
	});
	const collectionOptions = collectionsQuery.data ?? [];
	const collectionHierarchy = useMemo(
		() => buildCollectionHierarchy(collectionOptions),
		[collectionOptions],
	);
	const duplicateCollectionNames = useMemo(
		() => getDuplicateCollectionNames(collectionOptions),
		[collectionOptions],
	);
	const isExistingCollectionMode = collectionMode === "existing_override";
	const requiresTargetCollection = collectionMode !== "file";
	const requiresCollectionDescription = collectionMode === "create_override";
	const canUsePermissionControls =
		canCreateCollections && !isExistingCollectionMode;
	const targetCollectionNameKey = targetCollectionName.trim().toLocaleLowerCase();
	const hasAmbiguousTargetCollection =
		isExistingCollectionMode &&
		targetCollectionNameKey !== "" &&
		duplicateCollectionNames.has(targetCollectionNameKey);
	const hasVisibleTargetCollection =
		collectionMode !== "existing_override" ||
		collectionOptions.some((collection) => collection.name === targetCollectionName);
	const canSubmitCollectionOptions =
		!requiresTargetCollection ||
		(targetCollectionName.trim() !== "" &&
			hasVisibleTargetCollection &&
			!hasAmbiguousTargetCollection &&
			(!requiresCollectionDescription ||
				targetCollectionDescription.trim() !== ""));
	const filePermissionGroupValidation = useMemo(
		(): FilePermissionGroupValidation | null => {
			if (!parsedImport || !canUsePermissionControls || delegateGroupName.trim()) {
				return null;
			}

			const fileGroupNames = getFilePermissionGroupNames(parsedImport);
			if (fileGroupNames.length === 0) {
				return null;
			}

			if (groupsQuery.isError) {
				return {
					kind: "unchecked",
					reason:
						"Could not verify file permission groups because groups failed to load.",
				};
			}

			if (groupsQuery.isLoading || !groupsQuery.data) {
				return {
					kind: "unchecked",
					reason: "Verifying file permission groups...",
				};
			}

			const existingGroupNames = new Set(
				groupsQuery.data.map((group) => group.groupname),
			);
			const missingGroupNames = fileGroupNames.filter(
				(groupname) => !existingGroupNames.has(groupname),
			);

			if (missingGroupNames.length > 0) {
				return { kind: "missing", groupNames: missingGroupNames };
			}

			return { kind: "valid", groupNames: fileGroupNames };
		},
		[canUsePermissionControls, delegateGroupName, groupsQuery, parsedImport],
	);
	const canSubmitFilePermissionGroups =
		filePermissionGroupValidation?.kind !== "missing";

	useEffect(() => {
		const legacyTaskId = parsePositiveInteger(searchParams.get("taskId") ?? "");
		if (legacyTaskId) {
			router.replace(`/tasks/${legacyTaskId}`);
		}
	}, [router, searchParams]);

	useEffect(() => {
		if (!parsedImport || collectionOptions.length === 0) {
			return;
		}

		const hasSelectedOption = collectionOptions.some(
			(collection) => collection.name === targetCollectionName,
		);
		if (hasSelectedOption) {
			return;
		}

		const collectionSuggestion = getImportCollectionSuggestion(
			parsedImport,
			collectionOptions.map((collection) => collection.name),
		);
		if (
			collectionSuggestion.collectionName &&
			collectionOptions.some(
				(collection) => collection.name === collectionSuggestion.collectionName,
			)
		) {
			setTargetCollectionName(collectionSuggestion.collectionName);
		}
	}, [collectionOptions, parsedImport, targetCollectionName]);

	const submitMutation = useMutation({
		mutationFn: async () => {
			if (!parsedImport) {
				throw new Error("Select a valid JSON import file before submitting.");
			}

			const effectivePayload = buildImportSubmissionPayload(parsedImport, {
				atomicity,
				collisionPolicy,
				delegateGroupName: canUsePermissionControls
					? delegateGroupName
					: undefined,
				dryRun,
				collectionDescription: targetCollectionDescription,
				collectionMode,
				collectionName: targetCollectionName,
				permissionPolicy,
			});
			return createImportTask(effectivePayload, idempotencyKey);
		},
		onSuccess: (task) => {
			setSubmitError(null);
			router.push(`/tasks/${task.id}`);
		},
		onError: (error) => {
			setSubmitError(
				error instanceof Error ? error.message : "Failed to submit import.",
			);
		},
	});

	async function handleFileChange(event: FormEvent<HTMLInputElement>) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";

		if (!file) {
			return;
		}

		try {
			const text = await file.text();
			const payload = normalizeImportPayload(JSON.parse(text));
			setParsedImport(payload);
			setFileName(file.name);
			setDryRun(Boolean(payload.dry_run));
			setAtomicity(payload.mode?.atomicity ?? "strict");
			setCollisionPolicy(payload.mode?.collision_policy ?? "abort");
			setPermissionPolicy(payload.mode?.permission_policy ?? "abort");
			const collectionSuggestion = getImportCollectionSuggestion(
				payload,
				collectionOptions.map((collection) => collection.name),
			);
			setCollectionMode(
				canCreateCollections && !collectionSuggestion.isExistingCollectionPayload
					? "file"
					: "existing_override",
			);
			setTargetCollectionName(collectionSuggestion.collectionName);
			setTargetCollectionDescription(collectionSuggestion.description);
			setDelegateGroupName("");
			setParseError(null);
			setSubmitError(null);
		} catch (error) {
			setParsedImport(null);
			setFileName(file.name);
			setParseError(
				error instanceof Error
					? error.message
					: "Selected file is not a valid import document.",
			);
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSubmitError(null);
		submitMutation.mutate();
	}

	function handleLoadTask(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = parsePositiveInteger(taskLookupInput);
		if (!parsed) {
			return;
		}

		router.push(`/tasks/${parsed}`);
	}

	function renderFieldLabel(
		label: string,
		hintKey: HintKey,
		hint: ReactNode,
	) {
		const isOpen = activeHint === hintKey;

		return (
			<span className="control-label">
				<span>{label}</span>
				<span className="field-hint">
					<button
						type="button"
						className="field-hint-button"
						aria-label={`${label} help`}
						aria-expanded={isOpen}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							setActiveHint(isOpen ? null : hintKey);
						}}
					>
						?
					</button>
					{isOpen ? <span className="field-hint-popover">{hint}</span> : null}
				</span>
			</span>
		);
	}

	function renderTargetCollectionControl() {
		if (!requiresTargetCollection) {
			return null;
		}

		if (collectionMode === "create_override") {
			return (
				<label className="control-field">
					{renderFieldLabel(
						"Target collection",
						"target-collection",
						"All collection references in the submitted import will be rewritten to this collection.",
					)}
					<input
						required
						value={targetCollectionName}
						onChange={(event) => setTargetCollectionName(event.target.value)}
						placeholder="Shared Import"
					/>
				</label>
			);
		}

		const hasSelectedOption = collectionOptions.some(
			(collection) => collection.name === targetCollectionName,
		);

		return (
			<label className="control-field">
				{renderFieldLabel(
					"Target collection",
					"target-collection",
					"All collection references in the submitted import will be rewritten to this existing collection.",
				)}
				<select
					required
					value={targetCollectionName}
					onChange={(event) => setTargetCollectionName(event.target.value)}
					disabled={
						collectionsQuery.isLoading ||
						collectionsQuery.isError ||
						collectionOptions.length === 0
					}
				>
					<option value="">
						{collectionsQuery.isLoading
							? "Loading collections..."
							: collectionsQuery.isError
								? "Failed to load collections"
								: "Select collection"}
					</option>
					{collectionOptions.map((collection) => (
						<option key={collection.id} value={collection.name}>
							{formatCollectionOption(collection, collectionHierarchy.byId)}
						</option>
					))}
				</select>
				{targetCollectionName && !hasSelectedOption ? (
					<span className="field-note field-note--warning">
						The import references {targetCollectionName}, but that collection is
						not visible to your account.
					</span>
				) : hasAmbiguousTargetCollection ? (
					<span className="field-note field-note--warning">
						Multiple visible collections are named {targetCollectionName}. The
						import API matches existing collections by name, so choose a unique
						collection name before submitting.
					</span>
				) : null}
			</label>
		);
	}

	function renderDelegateGroupOverrideControl() {
		if (!canUsePermissionControls) {
			return null;
		}

		return (
			<div className="control-field">
				{renderFieldLabel(
					"Delegate group override",
					"delegate-group",
					"Use file values keeps permission groups declared in the JSON. Choosing a group replaces those grants with full permissions for that group.",
				)}
				{groupsQuery.isError ? (
					<input
						aria-label="Delegate group override"
						value={delegateGroupName}
						onChange={(event) => setDelegateGroupName(event.target.value)}
						placeholder="Use file values unless you enter a group name"
					/>
				) : (
					<select
						aria-label="Delegate group override"
						value={delegateGroupName}
						onChange={(event) => setDelegateGroupName(event.target.value)}
					>
						<option value="">Use file values</option>
						{(groupsQuery.data ?? []).map((group) => (
							<option key={group.id} value={group.groupname}>
								{group.groupname} (#{group.id})
							</option>
						))}
					</select>
				)}
				{filePermissionGroupValidation?.kind === "valid" ? (
					<span className="field-note">
						File groups verified:{" "}
						{filePermissionGroupValidation.groupNames.join(", ")}
					</span>
				) : null}
				{filePermissionGroupValidation?.kind === "missing" ? (
					<span className="field-note field-note--warning">
						File references missing group
						{filePermissionGroupValidation.groupNames.length === 1
							? ""
							: "s"}
						: {filePermissionGroupValidation.groupNames.join(", ")}
					</span>
				) : null}
				{filePermissionGroupValidation?.kind === "unchecked" ? (
					<span className="field-note">{filePermissionGroupValidation.reason}</span>
				) : null}
			</div>
		);
	}

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Imports</p>
					<h2>Submit import tasks</h2>
				</div>
				<p className="muted">
					Upload a JSON import document, choose execution mode, then continue on
					a dedicated task page for progress, events, and per-item outcomes.
				</p>
			</header>

			<div className="imports-layout">
				<section className="stack">
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Import submission</h3>
							<p className="muted">
								The file stays client-side until you submit a JSON request body
								to the backend.
							</p>
						</div>

						<form className="stack" onSubmit={handleSubmit}>
							<div className="form-grid">
								<label className="control-field control-field--wide">
									{renderFieldLabel(
										"Import file",
										"import-file",
										"Choose a Hubuum import JSON file. The file is parsed locally before submission.",
									)}
									<input
										ref={fileInputRef}
										className="json-editor-file"
										type="file"
										accept=".json,application/json"
										onChange={handleFileChange}
									/>
									<div className="file-picker">
										<button
											type="button"
											className="ghost"
											onClick={() => fileInputRef.current?.click()}
										>
											{fileName ? "Replace file" : "Choose file"}
										</button>
										<span
											className="muted file-picker-status"
											aria-live="polite"
										>
											{fileName || "No file selected."}
										</span>
									</div>
								</label>

								<label className="control-field">
									{renderFieldLabel(
										"Dry run",
										"dry-run",
										"Validate the transformed import request without applying changes.",
									)}
									<select
										value={dryRun ? "true" : "false"}
										onChange={(event) =>
											setDryRun(event.target.value === "true")
										}
									>
										<option value="false">Execute</option>
										<option value="true">Validate only</option>
									</select>
								</label>

								<label className="control-field">
									{renderFieldLabel(
										"Atomicity",
										"atomicity",
										"Strict aborts the import as a unit; best effort allows independent items to continue where possible.",
									)}
									<select
										value={atomicity}
										onChange={(event) =>
											setAtomicity(
												event.target.value as "strict" | "best_effort",
											)
										}
									>
										<option value="strict">Strict</option>
										<option value="best_effort">Best effort</option>
									</select>
								</label>

								<label className="control-field">
									{renderFieldLabel(
										"Collision policy",
										"collision-policy",
										"Choose whether existing matching records abort the import or are overwritten.",
									)}
									<select
										value={collisionPolicy}
										onChange={(event) =>
											setCollisionPolicy(
												event.target.value as "abort" | "overwrite",
											)
										}
									>
										<option value="abort">Abort</option>
										<option value="overwrite">Overwrite</option>
									</select>
								</label>

								<label className="control-field">
									{renderFieldLabel(
										"Collection handling",
										"collection-handling",
										canCreateCollections
											? "Use file collection keeps the JSON as-is. Use existing rewrites the import to an existing collection without permission changes. Create collection rewrites the import and includes collection creation and grants."
											: "Your account can only import into an existing collection, so collection creation and permission changes are not submitted.",
									)}
									<select
										value={collectionMode}
										onChange={(event) => {
											setCollectionMode(event.target.value as CollectionMode);
											setDelegateGroupName("");
										}}
										disabled={!canCreateCollections}
									>
										{canCreateCollections ? (
											<option value="file">Use file collection</option>
										) : null}
										<option value="existing_override">
											Use existing collection
										</option>
										{canCreateCollections ? (
											<option value="create_override">Create collection</option>
										) : null}
									</select>
								</label>

								{requiresTargetCollection
									? renderTargetCollectionControl()
									: renderDelegateGroupOverrideControl()}

								{requiresCollectionDescription ? (
									<label className="control-field control-field--wide">
										{renderFieldLabel(
											"Collection description",
											"collection-description",
											"Description used for the collection declaration added to the import request.",
										)}
										<input
											required
											value={targetCollectionDescription}
											onChange={(event) =>
												setTargetCollectionDescription(event.target.value)
											}
											placeholder="Collection purpose"
										/>
									</label>
								) : null}

								<label className="control-field">
									{renderFieldLabel(
										"Permission policy",
										"permission-policy",
										"Choose whether collection permission errors abort the import or allow the remaining import to continue.",
									)}
									<select
										value={permissionPolicy}
										disabled={!canUsePermissionControls}
										onChange={(event) =>
											setPermissionPolicy(
												event.target.value as "abort" | "continue",
											)
										}
									>
										<option value="abort">Abort</option>
										<option value="continue">Continue</option>
									</select>
								</label>

								{requiresTargetCollection
									? renderDelegateGroupOverrideControl()
									: null}

								<label className="control-field control-field--wide">
									{renderFieldLabel(
										"Idempotency key",
										"idempotency-key",
										"Optional key used by the backend to deduplicate repeated submissions of the same import.",
									)}
									<input
										value={idempotencyKey}
										onChange={(event) => setIdempotencyKey(event.target.value)}
										placeholder="inventory-import-2026-03-07"
									/>
								</label>
							</div>

							<div className="file-summary">
								<div>
									<strong>Selected file</strong>
									<p className="muted">
										{fileName || "Choose a JSON import file to inspect it."}
									</p>
								</div>
								{importSummary ? (
									<div className="summary-grid">
										<div className="summary-pill">
											<span>Total items</span>
											<strong>{importSummary.totalItems}</strong>
										</div>
										{importSummary.sections.map((section) => (
											<div key={section.name} className="summary-pill">
												<span>{section.name.replaceAll("_", " ")}</span>
												<strong>{section.count}</strong>
											</div>
										))}
									</div>
								) : (
									<div className="empty-state">
										Load a valid import document to inspect section counts.
									</div>
								)}
							</div>

							{parseError ? (
								<div className="error-banner">{parseError}</div>
							) : null}
							{submitError ? (
								<div className="error-banner">{submitError}</div>
							) : null}
							{collectionsQuery.isError && isExistingCollectionMode ? (
								<div className="muted">
									Could not load collections. Reload the page before submitting
									an import into an existing collection.
								</div>
							) : null}
							{canUsePermissionControls && groupsQuery.isError ? (
								<div className="muted">
									Could not load groups automatically. You can still override
									delegation by entering a group name manually.
								</div>
							) : null}

							<div className="action-row">
								<button
									type="submit"
									disabled={
										submitMutation.isPending ||
										!parsedImport ||
										!canSubmitCollectionOptions ||
										!canSubmitFilePermissionGroups
									}
								>
									{submitMutation.isPending ? "Submitting..." : "Submit import"}
								</button>
								<span className="muted">
									Successful submissions open a dedicated task page so you can
									keep multiple imports in flight.
								</span>
							</div>
						</form>
					</article>
				</section>

				<section className="stack">
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Open an existing task</h3>
							<p className="muted">
								Resume any known import task by ID without reloading an import
								file.
							</p>
						</div>

						<form className="action-row" onSubmit={handleLoadTask}>
							<input
								type="number"
								min={1}
								value={taskLookupInput}
								onChange={(event) => setTaskLookupInput(event.target.value)}
								placeholder="Task ID"
							/>
							<button type="submit" className="ghost">
								Open task
							</button>
						</form>
					</article>

					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>What happens next</h3>
						</div>
						<div className="template-help">
							<span>
								Submit an import here, then continue on `/tasks/[taskId]`.
							</span>
							<span>
								The task page shows status, lifecycle events, and
								import-specific results.
							</span>
							<span>
								Polling stops automatically when the task reaches a terminal
								state.
							</span>
						</div>
					</article>
				</section>
			</div>
		</section>
	);
}
