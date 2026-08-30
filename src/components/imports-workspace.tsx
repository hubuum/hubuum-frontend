"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
	FormEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CollectionDirectoryLookup } from "@/components/collection-directory-lookup";
import { GroupDirectoryLookup } from "@/components/group-directory-lookup";
import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import {
	fetchAllGroups,
	fetchGroupDirectory,
	fetchGroupsByIds,
} from "@/lib/api/group-directory";
import {
	fetchCollectionDirectory,
	fetchCollectionsByExactName,
} from "@/lib/api/resource-directory";
import {
	createImportTask,
	fetchTasks,
	getTaskProgressPercent,
	getTaskStatusTone,
	isTerminalTaskStatus,
	type ImportRequest,
	type TaskRecord,
} from "@/lib/api/tasking";
import {
	buildImportSubmissionPayload,
	getImportCollectionSuggestion,
	type CollectionMode,
} from "@/lib/import-payload";
import {
	findMissingImportPermissionGroups,
	getImportPermissionGroups,
} from "@/lib/import-permission-groups";
import {
	formatScopedGroupName,
	normalizeIdentityScope,
} from "@/lib/identity-scopes";
import { MAX_IDEMPOTENCY_KEY_BYTES } from "@/lib/idempotency-key";
import { filterMine } from "@/lib/task-notifications";
import { useCurrentUserId } from "@/lib/use-current-user-id";
import {
	directoryLookupStatus,
	useDirectorySearch,
} from "@/lib/use-directory-search";

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
	currentUsername: string | null;
};

const IMPORT_STEPS = [
	{ id: "file", label: "File", hint: "Select and inspect" },
	{
		id: "destination",
		label: "Destination",
		hint: "Map collections and access",
	},
	{ id: "policies", label: "Policies", hint: "Conflicts and failures" },
	{ id: "review", label: "Review", hint: "Validate or execute" },
] as const;

type ImportStep = (typeof IMPORT_STEPS)[number]["id"];

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

function formatTaskTimestamp(value: string): string {
	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

function formatTaskProgress(task: TaskRecord): string {
	const percent = getTaskProgressPercent(task);
	if (task.progress.total_items <= 0) {
		return `${percent}%`;
	}

	return `${task.progress.processed_items} / ${task.progress.total_items} (${percent}%)`;
}

function ImportTasksTable({ tasks }: { tasks: readonly TaskRecord[] }) {
	return (
		<div className="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Import</th>
						<th>Status</th>
						<th>Progress</th>
						<th>Created</th>
						<th>Summary</th>
					</tr>
				</thead>
				<tbody>
					{tasks.map((task) => (
						<tr key={task.id}>
							<td>
								<Link className="row-link" href={`/tasks/${task.id}`}>
									Import #{task.id}
								</Link>
							</td>
							<td>
								<span
									className={`status-pill status-pill--${getTaskStatusTone(task.status)}`}
								>
									{task.status.replaceAll("_", " ")}
								</span>
							</td>
							<td>{formatTaskProgress(task)}</td>
							<td>{formatTaskTimestamp(task.created_at)}</td>
							<td>{task.summary ?? "n/a"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
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

export function ImportsWorkspace({
	canCreateCollections,
	currentUsername,
}: ImportsWorkspaceProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const currentUserId = useCurrentUserId(currentUsername);
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
	const [delegateGroupId, setDelegateGroupId] = useState("");
	const [idempotencyKey, setIdempotencyKey] = useState("");
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [activeHint, setActiveHint] = useState<HintKey | null>(null);
	const [activeStep, setActiveStep] = useState<ImportStep>("file");

	const importSummary = useMemo(
		() => (parsedImport ? summarizeImport(parsedImport) : null),
		[parsedImport],
	);
	const importTasksQuery = useQuery({
		queryKey: ["tasks", "imports", "tracker", currentUserId],
		queryFn: async () => {
			const page = await fetchTasks({
				kind: "import",
				submittedBy: currentUserId ?? undefined,
				limit: 50,
				sort: "created_at.desc,id.desc",
			});
			return currentUserId == null
				? page.tasks
				: filterMine(page.tasks, currentUserId);
		},
		refetchInterval: (query) => {
			const hasActiveImports = (query.state.data ?? []).some(
				(task) => !isTerminalTaskStatus(task.status),
			);
			return hasActiveImports ? 5000 : 15000;
		},
	});
	const importTasks = importTasksQuery.data ?? [];
	const activeImports = importTasks.filter(
		(task) => !isTerminalTaskStatus(task.status),
	);
	const previousImports = importTasks
		.filter((task) => isTerminalTaskStatus(task.status))
		.slice(0, 10);
	const isExistingCollectionMode = collectionMode === "existing_override";
	const requiresTargetCollection = collectionMode !== "file";
	const requiresCollectionDescription = collectionMode === "create_override";
	const canUsePermissionControls =
		canCreateCollections && !isExistingCollectionMode;
	const collectionDirectory = useDirectorySearch({
		queryKey: ["collection-directory", "imports-form"],
		queryFn: fetchCollectionDirectory,
		enabled: isExistingCollectionMode,
	});
	const delegateGroupDirectory = useDirectorySearch({
		queryKey: ["group-directory", "imports-form"],
		queryFn: fetchGroupDirectory,
		enabled: canUsePermissionControls,
	});
	const filePermissionGroups = useMemo(
		() => (parsedImport ? getImportPermissionGroups(parsedImport) : []),
		[parsedImport],
	);
	const exactTargetCollectionsQuery = useQuery({
		queryKey: [
			"collections",
			"imports-form",
			"exact-name",
			targetCollectionName.trim().toLocaleLowerCase(),
		],
		queryFn: async () => fetchCollectionsByExactName(targetCollectionName),
		enabled:
			isExistingCollectionMode && targetCollectionName.trim().length > 0,
		retry: false,
		staleTime: 5 * 60 * 1000,
	});
	const parsedDelegateGroupId = parsePositiveInteger(delegateGroupId);
	const selectedDelegateGroupQuery = useQuery({
		queryKey: ["groups", "imports-form", "selected", parsedDelegateGroupId],
		queryFn: async () =>
			fetchGroupsByIds(
				parsedDelegateGroupId === null ? [] : [parsedDelegateGroupId],
			),
		enabled: canUsePermissionControls && parsedDelegateGroupId !== null,
		retry: false,
		staleTime: 5 * 60 * 1000,
	});
	const allGroupsQuery = useQuery({
		queryKey: ["groups", "imports-form", "complete"],
		queryFn: fetchAllGroups,
		enabled:
			canUsePermissionControls &&
			delegateGroupId.trim() === "" &&
			filePermissionGroups.length > 0,
		retry: false,
		staleTime: 5 * 60 * 1000,
	});
	const exactTargetCollections = exactTargetCollectionsQuery.data ?? [];
	const hasAmbiguousTargetCollection =
		isExistingCollectionMode &&
		exactTargetCollections.length > 1;
	const resolvedTargetCollection =
		exactTargetCollections.length === 1 ? exactTargetCollections[0] : null;
	const hasResolvedTargetCollection =
		!isExistingCollectionMode ||
		(exactTargetCollectionsQuery.isSuccess &&
			!exactTargetCollectionsQuery.isFetching &&
			resolvedTargetCollection !== null);
	const canSubmitCollectionOptions =
		!requiresTargetCollection ||
		(targetCollectionName.trim() !== "" &&
			hasResolvedTargetCollection &&
			!hasAmbiguousTargetCollection &&
			(!requiresCollectionDescription ||
				targetCollectionDescription.trim() !== ""));
	const selectedDelegateGroup = selectedDelegateGroupQuery.data?.find(
		(group) => group.id === parsedDelegateGroupId,
	);
	const filePermissionGroupValidation =
		useMemo((): FilePermissionGroupValidation | null => {
			if (
				!parsedImport ||
				!canUsePermissionControls ||
				delegateGroupId.trim()
			) {
				return null;
			}

			if (filePermissionGroups.length === 0) {
				return null;
			}

			if (allGroupsQuery.isError) {
				return {
					kind: "unchecked",
					reason:
						"Could not verify file permission groups because groups failed to load.",
				};
			}

			if (allGroupsQuery.isLoading || !allGroupsQuery.data) {
				return {
					kind: "unchecked",
					reason: "Verifying file permission groups...",
				};
			}

			const missingGroupNames = findMissingImportPermissionGroups(
				filePermissionGroups,
				allGroupsQuery.data,
			);

			if (missingGroupNames.length > 0) {
				return { kind: "missing", groupNames: missingGroupNames };
			}

			return {
				kind: "valid",
				groupNames: filePermissionGroups.map((group) => group.label),
			};
		}, [
			allGroupsQuery.data,
			allGroupsQuery.isError,
			allGroupsQuery.isLoading,
			canUsePermissionControls,
			delegateGroupId,
			filePermissionGroups,
			parsedImport,
		]);
	const hasValidDelegateGroup =
		delegateGroupId.trim() === "" ||
		(parsedDelegateGroupId !== null &&
			selectedDelegateGroupQuery.isSuccess &&
			!selectedDelegateGroupQuery.isFetching &&
			selectedDelegateGroup !== undefined);
	const canSubmitFilePermissionGroups =
		!canUsePermissionControls ||
		(hasValidDelegateGroup &&
			(delegateGroupId.trim() !== "" ||
				filePermissionGroups.length === 0 ||
				filePermissionGroupValidation?.kind === "valid"));

	useEffect(() => {
		const legacyTaskId = parsePositiveInteger(searchParams.get("taskId") ?? "");
		if (legacyTaskId) {
			router.replace(`/tasks/${legacyTaskId}`);
		}
	}, [router, searchParams]);

	const submitMutation = useMutation({
		mutationFn: async () => {
			if (!parsedImport) {
				throw new Error("Select a valid JSON import file before submitting.");
			}

			const effectivePayload = buildImportSubmissionPayload(parsedImport, {
				atomicity,
				collisionPolicy,
				delegateGroupName: canUsePermissionControls
					? selectedDelegateGroup?.groupname
					: undefined,
				delegateGroupIdentityScope:
					selectedDelegateGroup === undefined
						? undefined
						: normalizeIdentityScope(selectedDelegateGroup.identity_scope),
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
			const collectionSuggestion = getImportCollectionSuggestion(payload);
			const nextCollectionMode =
				canCreateCollections &&
					!collectionSuggestion.isExistingCollectionPayload
					? "file"
					: "existing_override";
			setCollectionMode(nextCollectionMode);
			setTargetCollectionName(collectionSuggestion.collectionName);
			collectionDirectory.setSearch(
				nextCollectionMode === "existing_override"
					? collectionSuggestion.collectionName
					: "",
			);
			setTargetCollectionDescription(collectionSuggestion.description);
			setDelegateGroupId("");
			delegateGroupDirectory.setSearch("");
			setParseError(null);
			setSubmitError(null);
			setActiveStep("file");
		} catch (error) {
			setParsedImport(null);
			setFileName(file.name);
			setParseError(
				error instanceof Error
					? error.message
					: "Selected file is not a valid import document.",
			);
			setActiveStep("file");
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSubmitError(null);
		submitMutation.mutate();
	}

	function renderFieldLabel(label: string, hintKey: HintKey, hint: ReactNode) {
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

		return (
			<div className="control-field">
				{renderFieldLabel(
					"Target collection",
					"target-collection",
					"All collection references in the submitted import will be rewritten to this existing collection.",
				)}
				<CollectionDirectoryLookup
					collections={collectionDirectory.query.data?.items ?? []}
					helperText={directoryLookupStatus({
						count: collectionDirectory.query.data?.items.length ?? 0,
						isError: collectionDirectory.query.isError,
						isLoading: collectionDirectory.query.isLoading,
						isPartial: Boolean(collectionDirectory.query.data?.isPartial),
						isReady: collectionDirectory.isReady,
						minimumLength: collectionDirectory.minimumLength,
						resourcePlural: "collections",
						resourceSingular: "collection",
						term: collectionDirectory.term,
					})}
					idPrefix="import-target-collection-directory"
					onChange={collectionDirectory.setSearch}
					onSelect={(collection) => {
						setTargetCollectionName(collection.name);
						collectionDirectory.setSearch("");
						setSubmitError(null);
					}}
					value={collectionDirectory.search}
				/>
				{exactTargetCollectionsQuery.isFetching ? (
					<span className="field-note">
						Resolving the exact collection name…
					</span>
				) : null}
				{resolvedTargetCollection && !hasAmbiguousTargetCollection ? (
					<span className="field-note">
						Selected: {resolvedTargetCollection.name} (#
						{resolvedTargetCollection.id})
					</span>
				) : null}
				{targetCollectionName &&
				exactTargetCollectionsQuery.isSuccess &&
				exactTargetCollections.length === 0 ? (
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
				) : exactTargetCollectionsQuery.isError ? (
					<span className="field-note field-note--warning">
						Could not resolve the exact collection name. Try the lookup again.
					</span>
				) : null}
			</div>
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
				<div className="directory-id-lookup-control">
					<input
						aria-label="Delegate group override"
						type="number"
						min={1}
						value={delegateGroupId}
						onChange={(event) => {
							setDelegateGroupId(event.target.value);
							delegateGroupDirectory.setSearch(event.target.value);
							setSubmitError(null);
						}}
						placeholder="Blank uses file values"
					/>
					<GroupDirectoryLookup
						groups={delegateGroupDirectory.query.data?.items ?? []}
						helperText={directoryLookupStatus({
							count: delegateGroupDirectory.query.data?.items.length ?? 0,
							isError: delegateGroupDirectory.query.isError,
							isLoading: delegateGroupDirectory.query.isLoading,
							isPartial: Boolean(
								delegateGroupDirectory.query.data?.isPartial,
							),
							isReady: delegateGroupDirectory.isReady,
							minimumLength: delegateGroupDirectory.minimumLength,
							resourcePlural: "groups",
							resourceSingular: "group",
							term: delegateGroupDirectory.term,
						})}
						idPrefix="import-delegate-group-directory"
						onChange={delegateGroupDirectory.setSearch}
						onSelect={(group) => {
							setDelegateGroupId(String(group.id));
							delegateGroupDirectory.setSearch("");
							setSubmitError(null);
						}}
						value={delegateGroupDirectory.search}
					/>
				</div>
				{selectedDelegateGroup ? (
					<span className="field-note">
						Selected: {formatScopedGroupName(selectedDelegateGroup)} (#
						{selectedDelegateGroup.id})
					</span>
				) : delegateGroupId.trim() ? (
					<span className="field-note field-note--warning">
						{selectedDelegateGroupQuery.isFetching
							? "Resolving the exact group ID…"
							: "Choose an existing group by name or exact ID."}
					</span>
				) : (
					<span className="field-note">Using permission groups from the file.</span>
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
						{filePermissionGroupValidation.groupNames.length === 1 ? "" : "s"}:{" "}
						{filePermissionGroupValidation.groupNames.join(", ")}
					</span>
				) : null}
				{filePermissionGroupValidation?.kind === "unchecked" ? (
					<span className="field-note">
						{filePermissionGroupValidation.reason}
					</span>
				) : null}
			</div>
		);
	}

	function getStepError(step: ImportStep): string | null {
		if (step === "file") {
			return parsedImport
				? null
				: (parseError ?? "Choose a valid import file.");
		}
		if (step === "destination") {
			if (!canSubmitCollectionOptions) {
				return "Choose an unambiguous destination collection and complete its details.";
			}
			if (!canSubmitFilePermissionGroups) {
				return "Choose an existing delegate group for the file permissions.";
			}
		}
		return null;
	}

	function continueFrom(step: ImportStep, nextStep: ImportStep) {
		const error = getStepError(step);
		setSubmitError(error);
		if (!error) setActiveStep(nextStep);
	}

	function renderFileSummary() {
		return (
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
		);
	}

	const fileReady = getStepError("file") === null;
	const destinationReady = fileReady && getStepError("destination") === null;
	const importSteps = IMPORT_STEPS.map((step) => ({
		...step,
		enabled:
			step.id === "file" ||
			(step.id === "destination" && fileReady) ||
			(step.id === "policies" && destinationReady) ||
			(step.id === "review" && destinationReady),
	}));
	const destinationSummary =
		collectionMode === "file"
			? "Use collection declarations from the file"
			: collectionMode === "existing_override"
				? `Import into ${targetCollectionName || "an existing collection"}`
				: `Create ${targetCollectionName || "a new collection"}`;

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<h2>Submit import tasks</h2>
				</div>
				<p className="muted">
					Upload a JSON import document, choose execution mode, then continue on
					a dedicated task page for progress, events, and per-item outcomes.
				</p>
			</header>

			<div className="stack">
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
							<GuidedFlowTabs
								activeStep={activeStep}
								ariaLabel="Import submission steps"
								onChange={(step) => {
									setSubmitError(null);
									setActiveStep(step);
								}}
								steps={importSteps}
							/>

							{activeStep === "file" ? (
								<GuidedFlowPanel stepId="file">
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
									{renderFileSummary()}
									<GuidedFlowContinue
										disabled={!fileReady}
										nextLabel="Destination"
										onContinue={() => continueFrom("file", "destination")}
										summary={
											importSummary
												? `${importSummary.totalItems} items parsed locally`
												: "Choose a valid Hubuum import document"
										}
										title={
											fileReady
												? "File ready"
												: "Select and inspect an import file"
										}
									/>
								</GuidedFlowPanel>
							) : null}

							{activeStep === "destination" ? (
								<GuidedFlowPanel stepId="destination">
									<div className="form-grid">
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
													const nextMode =
														event.target.value as CollectionMode;
													setCollectionMode(nextMode);
													setDelegateGroupId("");
													delegateGroupDirectory.setSearch("");
													collectionDirectory.setSearch(
														nextMode === "existing_override"
															? targetCollectionName
															: "",
													);
													setSubmitError(null);
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
													<option value="create_override">
														Create collection
													</option>
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
													onChange={(event) => {
														setTargetCollectionDescription(event.target.value);
														setSubmitError(null);
													}}
													placeholder="Collection purpose"
												/>
											</label>
										) : null}
										{requiresTargetCollection
											? renderDelegateGroupOverrideControl()
											: null}
									</div>
									<GuidedFlowContinue
										disabled={!destinationReady}
										nextLabel="Policies"
										onBack={() => setActiveStep("file")}
										onContinue={() => continueFrom("destination", "policies")}
										summary={destinationSummary}
										title={
											destinationReady
												? "Destination ready"
												: "Complete the destination and access mapping"
										}
									/>
								</GuidedFlowPanel>
							) : null}

							{activeStep === "policies" ? (
								<GuidedFlowPanel stepId="policies">
									<div className="form-grid">
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
										<label className="control-field control-field--wide">
											{renderFieldLabel(
												"Idempotency key",
												"idempotency-key",
												"Optional key used by the backend to deduplicate repeated submissions of the same import.",
											)}
											<input
												value={idempotencyKey}
												maxLength={MAX_IDEMPOTENCY_KEY_BYTES}
												onChange={(event) =>
													setIdempotencyKey(event.target.value)
												}
												placeholder="inventory-import-2026-03-07"
											/>
											<span className="field-note">
												At most {MAX_IDEMPOTENCY_KEY_BYTES} UTF-8 bytes.
											</span>
										</label>
									</div>
									{collisionPolicy === "overwrite" ? (
										<div className="warning-banner">
											Matching records may be overwritten when this import
											executes.
										</div>
									) : null}
									<GuidedFlowContinue
										nextLabel="Review"
										onBack={() => setActiveStep("destination")}
										onContinue={() => continueFrom("policies", "review")}
										summary={`${atomicity === "strict" ? "Strict" : "Best effort"} · ${collisionPolicy} collisions · ${permissionPolicy} on permission errors`}
										title="Execution policies ready"
									/>
								</GuidedFlowPanel>
							) : null}

							{activeStep === "review" ? (
								<GuidedFlowPanel stepId="review">
									{renderFileSummary()}
									<dl className="guided-flow-review-list">
										<div>
											<dt>Destination</dt>
											<dd>{destinationSummary}</dd>
										</div>
										<div>
											<dt>Conflicts</dt>
											<dd>
												{collisionPolicy === "abort"
													? "Abort on matching records"
													: "Overwrite matching records"}
											</dd>
										</div>
										<div>
											<dt>Failure handling</dt>
											<dd>
												{atomicity === "strict"
													? "Abort the import as one unit"
													: "Continue independent items where possible"}
											</dd>
										</div>
										<div>
											<dt>Permission errors</dt>
											<dd>
												{permissionPolicy === "abort"
													? "Abort"
													: "Continue remaining work"}
											</dd>
										</div>
									</dl>
									<div className="segmented-options import-intent-picker">
										<button
											type="button"
											className={dryRun ? "is-selected" : "ghost"}
											aria-pressed={dryRun}
											onClick={() => setDryRun(true)}
										>
											<span>Validate only</span>
											<small>
												Check the transformed request without changing data
											</small>
										</button>
										<button
											type="button"
											className={!dryRun ? "is-selected" : "ghost"}
											aria-pressed={!dryRun}
											onClick={() => setDryRun(false)}
										>
											<span>Execute import</span>
											<small>
												Apply the reviewed import as a background task
											</small>
										</button>
									</div>
									{!dryRun && collisionPolicy === "overwrite" ? (
										<div className="warning-banner">
											This execution can replace matching records. Validate
											first if you have not already reviewed a dry run.
										</div>
									) : null}
									<div className="form-actions">
										<button
											type="button"
											className="ghost"
											onClick={() => setActiveStep("policies")}
											disabled={submitMutation.isPending}
										>
											Back
										</button>
										<button
											type="submit"
											disabled={submitMutation.isPending || !destinationReady}
										>
											{submitMutation.isPending
												? "Submitting..."
												: dryRun
													? "Submit validation"
													: "Execute import"}
										</button>
									</div>
								</GuidedFlowPanel>
							) : null}

							{parseError ? (
								<div className="error-banner">{parseError}</div>
							) : null}
							{submitError ? (
								<div className="error-banner">{submitError}</div>
							) : null}
						</form>
					</article>

					{activeImports.length > 0 ? (
						<section className="stack detail-content-section">
							<header className="detail-section-heading">
								<div className="detail-section-heading-copy">
									<h2>Active imports</h2>
								</div>
								<span className="muted">{activeImports.length} active</span>
							</header>

							<article className="card stack panel-card">
								<ImportTasksTable tasks={activeImports} />
							</article>
						</section>
					) : null}

					<section className="stack detail-content-section">
						<header className="detail-section-heading">
							<div className="detail-section-heading-copy">
								<h2>Previous imports</h2>
							</div>
							<Link className="link-chip" href="/tasks">
								Browse tasks
							</Link>
						</header>

						<article className="card stack panel-card">
							{importTasksQuery.isLoading ? (
								<div className="muted">Loading previous imports...</div>
							) : null}
							{importTasksQuery.isError ? (
								<div className="error-banner">
									Failed to load previous imports.{" "}
									{importTasksQuery.error instanceof Error
										? importTasksQuery.error.message
										: "Unknown error"}
								</div>
							) : null}
							{!importTasksQuery.isLoading &&
							!importTasksQuery.isError &&
							previousImports.length === 0 ? (
								<div className="empty-state">No previous imports.</div>
							) : null}
							{previousImports.length > 0 ? (
								<ImportTasksTable tasks={previousImports} />
							) : null}
						</article>
					</section>
				</section>
			</div>
		</section>
	);
}
