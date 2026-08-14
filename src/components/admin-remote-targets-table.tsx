"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ClassDirectoryLookup } from "@/components/class-directory-lookup";
import { CollectionDirectoryLookup } from "@/components/collection-directory-lookup";
import { CreateModal } from "@/components/create-modal";
import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import { ResourceIndexHeading } from "@/components/resource-index-heading";
import { TableExportMenu } from "@/components/table-export-menu";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1RemoteTargetsByTargetId,
	patchApiV1RemoteTargetsByTargetId,
	postApiV1RemoteTargets,
} from "@/lib/api/generated/client";
import type {
	Collection,
	HubuumClassExpanded,
	NewRemoteTarget,
	RemoteHttpMethod,
	RemoteTarget,
	RemoteTargetSubjectType,
	UpdateRemoteTarget,
} from "@/lib/api/generated/models";
import { fetchRemoteTargetsPage } from "@/lib/api/remote-targets";
import {
	fetchClassesByIds,
	fetchCollectionClassDirectory,
	fetchCollectionDirectory,
	fetchCollectionsByIds,
} from "@/lib/api/resource-directory";
import {
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
} from "@/lib/create-events";
import {
	buildRemoteTargetAuthConfig,
	buildRemoteTargetPayload,
	defaultRemoteTargetFormState,
	formatRemoteTargetSubjectTypes,
	REMOTE_TARGET_SUBJECT_TYPES,
	remoteTargetFormStateFromTarget,
	type RemoteTargetFormState,
	validateRemoteTargetRequest,
	validateRemoteTargetScope,
	validateRemoteTargetTemplates,
} from "@/lib/remote-target-form";
import { buildResourceSummary } from "@/lib/resource-summary";
import type { TableExportView } from "@/lib/table-export";
import {
	directoryLookupStatus,
	useDirectorySearch,
} from "@/lib/use-directory-search";

const METHODS: RemoteHttpMethod[] = ["get", "post", "patch", "delete"];

type FormMode = "create" | "edit";

const REMOTE_TARGET_STEPS = [
	{ id: "scope", label: "Scope", hint: "Collection and subject" },
	{ id: "request", label: "Request", hint: "Endpoint and method" },
	{ id: "templates", label: "Templates", hint: "Headers and body" },
	{ id: "authentication", label: "Authentication", hint: "Secret references" },
	{ id: "review", label: "Review", hint: "Confirm and save" },
] as const;

type RemoteTargetStep = (typeof REMOTE_TARGET_STEPS)[number]["id"];

function formatTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
}

export function AdminRemoteTargetsTable() {
	const queryClient = useQueryClient();
	const [targets, setTargets] = useState<RemoteTarget[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [tableError, setTableError] = useState<string | null>(null);
	const [tableSuccess, setTableSuccess] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [isModalOpen, setModalOpen] = useState(false);
	const [formMode, setFormMode] = useState<FormMode>("create");
	const [editingTarget, setEditingTarget] = useState<RemoteTarget | null>(null);
	const [formState, setFormState] = useState<RemoteTargetFormState>(
		defaultRemoteTargetFormState,
	);
	const [activeStep, setActiveStep] = useState<RemoteTargetStep>("scope");

	const referencedCollectionIds = useMemo(
		() =>
			[...new Set(targets.map((target) => target.collection_id))].sort(
				(left, right) => left - right,
			),
		[targets],
	);
	const referencedClassIds = useMemo(
		() =>
			[
				...new Set(
					targets.flatMap((target) =>
						target.class_id == null ? [] : [target.class_id],
					),
				),
			].sort((left, right) => left - right),
		[targets],
	);
	const collectionsQuery = useQuery({
		queryKey: ["collections", "admin-remote-targets", referencedCollectionIds],
		queryFn: () => fetchCollectionsByIds(referencedCollectionIds),
		enabled: referencedCollectionIds.length > 0,
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "admin-remote-targets", referencedClassIds],
		queryFn: () => fetchClassesByIds(referencedClassIds),
		enabled: referencedClassIds.length > 0,
	});
	const parsedCollectionId = Number.parseInt(formState.collectionId, 10);
	const collectionDirectory = useDirectorySearch({
		queryKey: ["remote-target-collection-directory"],
		queryFn: fetchCollectionDirectory,
	});
	const classDirectory = useDirectorySearch({
		enabled: Number.isFinite(parsedCollectionId) && parsedCollectionId > 0,
		queryKey: [
			"remote-target-class-directory",
			Number.isFinite(parsedCollectionId) ? parsedCollectionId : null,
		],
		queryFn: (query) =>
			fetchCollectionClassDirectory(parsedCollectionId, query),
	});

	const loadTargetsMutation = useMutation({
		mutationFn: async (cursor?: string | null) =>
			fetchRemoteTargetsPage({ cursor: cursor ?? undefined, limit: 100 }),
		onSuccess: (page, cursor) => {
			setTargets((current) =>
				cursor ? [...current, ...page.targets] : page.targets,
			);
			setNextCursor(page.nextCursor);
			setTableError(null);
		},
		onError: (error) => {
			setTableError(
				error instanceof Error
					? error.message
					: "Failed to load remote targets.",
			);
		},
	});

	const createMutation = useMutation({
		mutationFn: async (payload: NewRemoteTarget) => {
			const response = await postApiV1RemoteTargets(payload, {
				credentials: "include",
			});

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to create remote target."),
				);
			}

			return response.data;
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			setModalOpen(false);
			setTableSuccess("Remote target created.");
			setTableError(null);
			loadTargetsMutation.mutate(null);
		},
		onError: (error) => {
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to create remote target.",
			);
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			payload,
			targetId,
		}: {
			payload: UpdateRemoteTarget;
			targetId: number;
		}) => {
			const response = await patchApiV1RemoteTargetsByTargetId(
				targetId,
				payload,
				{ credentials: "include" },
			);

			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to update remote target."),
				);
			}

			return response.data;
		},
		onSuccess: () => {
			setModalOpen(false);
			setTableSuccess("Remote target updated.");
			setTableError(null);
			loadTargetsMutation.mutate(null);
		},
		onError: (error) => {
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to update remote target.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (target: RemoteTarget) => {
			const response = await deleteApiV1RemoteTargetsByTargetId(target.id, {
				credentials: "include",
			});

			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to delete remote target."),
				);
			}
		},
		onSuccess: (_, target) => {
			setTargets((current) => current.filter((item) => item.id !== target.id));
			setTableError(null);
			setTableSuccess(`Remote target "${target.name}" deleted.`);
		},
		onError: (error) => {
			setTableSuccess(null);
			setTableError(
				error instanceof Error
					? error.message
					: "Failed to delete remote target.",
			);
		},
	});

	useEffect(() => {
		loadTargetsMutation.mutate(null);
	}, [loadTargetsMutation.mutate]);

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "admin-remote-targets") {
				return;
			}

			openCreateModal();
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	});

	const collectionsById = useMemo(() => {
		const map = new Map<number, Collection>();
		for (const collection of collectionsQuery.data ?? []) {
			map.set(collection.id, collection);
		}
		for (const collection of collectionDirectory.query.data?.items ?? []) {
			map.set(collection.id, collection);
		}
		return map;
	}, [collectionDirectory.query.data?.items, collectionsQuery.data]);
	const classesById = useMemo(() => {
		const map = new Map<number, HubuumClassExpanded>();
		for (const hubuumClass of classesQuery.data ?? []) {
			map.set(hubuumClass.id, hubuumClass);
		}
		for (const hubuumClass of classDirectory.query.data?.items ?? []) {
			map.set(hubuumClass.id, hubuumClass);
		}
		return map;
	}, [classDirectory.query.data?.items, classesQuery.data]);
	const visibleTargets = useMemo(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) {
			return targets;
		}

		return targets.filter((target) => {
			const haystack = [
				target.name,
				target.description,
				target.method,
				String(target.collection_id),
				collectionsById.get(target.collection_id)?.name ?? "",
				target.class_id == null ? "" : String(target.class_id),
				target.class_id == null
					? ""
					: (classesById.get(target.class_id)?.name ?? ""),
				target.allowed_subject_types.join(" "),
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(needle);
		});
	}, [classesById, collectionsById, search, targets]);
	const targetExportView = useMemo<TableExportView<RemoteTarget>>(
		() => ({
			id: "admin.remote-targets",
			fileName: "remote-targets-view",
			sheetName: "Remote targets",
			columns: [
				{
					key: "name",
					label: "Name",
					getValue: (target) =>
						target.description
							? `${target.name}\n${target.description}`
							: target.name,
				},
				{
					key: "collection",
					label: "Collection",
					getValue: (target) =>
						collectionsById.get(target.collection_id)?.name ??
						`#${target.collection_id}`,
				},
				{
					key: "method",
					label: "Method",
					getValue: (target) => target.method.toUpperCase(),
				},
				{
					key: "subject",
					label: "Subject",
					getValue: (target) => target.allowed_subject_types.join(", "),
				},
				{
					key: "class_scope",
					label: "Class scope",
					getValue: (target) =>
						target.class_id == null
							? "n/a"
							: (classesById.get(target.class_id)?.name ??
								`#${target.class_id}`),
				},
				{
					key: "enabled",
					label: "Enabled",
					getValue: (target) => (target.enabled ? "yes" : "no"),
				},
				{
					key: "updated",
					label: "Updated",
					getValue: (target) => formatTimestamp(target.updated_at),
				},
			],
			rows: visibleTargets,
		}),
		[classesById, collectionsById, visibleTargets],
	);

	const resourceSummary = buildResourceSummary({
		shown: search.trim() ? visibleTargets.length : null,
		loaded: targets.length,
		details: nextCursor ? ["more available"] : [],
	});

	function openCreateModal() {
		setFormMode("create");
		setEditingTarget(null);
		setFormError(null);
		setFormState({
			...defaultRemoteTargetFormState,
			allowedSubjectTypes: [
				...defaultRemoteTargetFormState.allowedSubjectTypes,
			],
			collectionId: "",
		});
		collectionDirectory.setSearch("");
		classDirectory.setSearch("");
		setActiveStep("scope");
		setModalOpen(true);
	}

	function openEditModal(target: RemoteTarget) {
		setFormMode("edit");
		setEditingTarget(target);
		setFormError(null);
		setFormState(remoteTargetFormStateFromTarget(target));
		collectionDirectory.setSearch(String(target.collection_id));
		classDirectory.setSearch(
			target.class_id == null ? "" : String(target.class_id),
		);
		setActiveStep("scope");
		setModalOpen(true);
	}

	function toggleSubjectType(
		subjectType: RemoteTargetSubjectType,
		checked: boolean,
	) {
		setFormError(null);
		setFormState((current) => {
			const allowedSubjectTypes = checked
				? current.allowedSubjectTypes.includes(subjectType)
					? current.allowedSubjectTypes
					: [...current.allowedSubjectTypes, subjectType]
				: current.allowedSubjectTypes.filter((item) => item !== subjectType);

			return {
				...current,
				allowedSubjectTypes,
				classId: subjectType === "object" && !checked ? "" : current.classId,
			};
		});
	}

	function patchFormState(patch: Partial<RemoteTargetFormState>) {
		setFormState((current) => ({ ...current, ...patch }));
		setFormError(null);
	}

	function getStepError(step: RemoteTargetStep): string | null {
		try {
			if (step === "scope") {
				validateRemoteTargetScope(formState);
				if (formState.allowedSubjectTypes.includes("object")) {
					const classId = Number.parseInt(formState.classId, 10);
					const collectionId = Number.parseInt(formState.collectionId, 10);
					const selectedClass = classesById.get(classId);
					if (!selectedClass || selectedClass.collection.id !== collectionId) {
						throw new Error(
							"Class scope must belong to the selected collection.",
						);
					}
				}
				return null;
			}
			if (step === "request") {
				validateRemoteTargetRequest(formState);
				return null;
			}
			if (step === "templates") {
				validateRemoteTargetTemplates(formState);
				return null;
			}
			if (step === "authentication") {
				buildRemoteTargetAuthConfig(formState);
				return null;
			}
			buildRemoteTargetPayload(formState);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : "Invalid remote target.";
		}
	}

	function continueFrom(step: RemoteTargetStep, nextStep: RemoteTargetStep) {
		const error = getStepError(step);
		setFormError(error);
		if (!error) setActiveStep(nextStep);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setTableSuccess(null);

		let payload: NewRemoteTarget;
		try {
			payload = buildRemoteTargetPayload(formState);
			if (payload.class_id != null) {
				const selectedClass = classesById.get(payload.class_id);
				if (
					!selectedClass ||
					selectedClass.collection.id !== payload.collection_id
				) {
					setFormError("Class scope must belong to the selected collection.");
					return;
				}
			}
		} catch (error) {
			setFormError(
				error instanceof Error ? error.message : "Invalid form data.",
			);
			return;
		}

		if (formMode === "edit" && editingTarget) {
			updateMutation.mutate({
				targetId: editingTarget.id,
				payload: payload as UpdateRemoteTarget,
			});
			return;
		}

		createMutation.mutate(payload);
	}

	function onDelete(target: RemoteTarget) {
		setTableError(null);
		setTableSuccess(null);
		if (!window.confirm(`Delete remote target "${target.name}"?`)) {
			return;
		}

		deleteMutation.mutate(target);
	}

	const isSaving = createMutation.isPending || updateMutation.isPending;
	const scopeReady = getStepError("scope") === null;
	const requestReady = scopeReady && getStepError("request") === null;
	const templatesReady = requestReady && getStepError("templates") === null;
	const authenticationReady =
		templatesReady && getStepError("authentication") === null;
	const remoteTargetSteps = REMOTE_TARGET_STEPS.map((step) => ({
		...step,
		enabled:
			step.id === "scope" ||
			(step.id === "request" && scopeReady) ||
			(step.id === "templates" && requestReady) ||
			(step.id === "authentication" && templatesReady) ||
			(step.id === "review" && authenticationReady),
	}));
	const allowsObjects = formState.allowedSubjectTypes.includes("object");
	const selectedSubjectTypes = formatRemoteTargetSubjectTypes(
		formState.allowedSubjectTypes,
	);
	const selectedCollection = collectionsById.get(
		Number.parseInt(formState.collectionId, 10),
	);
	const selectedClass = classesById.get(Number.parseInt(formState.classId, 10));
	const authenticationSummary =
		formState.authType === "none"
			? "No authentication"
			: formState.authType === "bearer_secret"
				? `Bearer token from ${formState.authSecret || "a secret reference"}`
				: formState.authType === "basic_secret"
					? `Basic authentication as ${formState.authUsername || "a username"}`
					: `${formState.authHeader || "API key header"} from ${formState.authSecret || "a secret reference"}`;

	return (
		<div className="stack">
			<CreateModal
				open={isModalOpen}
				title={
					formMode === "edit" ? "Edit remote target" : "Create remote target"
				}
				onClose={() => setModalOpen(false)}
			>
				<form className="stack" onSubmit={onSubmit}>
					<GuidedFlowTabs
						activeStep={activeStep}
						ariaLabel="Remote target steps"
						onChange={(step) => {
							setFormError(null);
							setActiveStep(step);
						}}
						steps={remoteTargetSteps}
					/>

					{activeStep === "scope" ? (
						<GuidedFlowPanel stepId="scope">
							<div className="form-grid">
								<div className="control-field">
									<label htmlFor="remote-target-collection">
										Collection ID
									</label>
									<div className="directory-id-lookup-control">
										<input
											id="remote-target-collection"
											required
											type="number"
											min={1}
											value={formState.collectionId}
											onChange={(event) => {
												patchFormState({
													collectionId: event.target.value,
													classId: "",
												});
												collectionDirectory.setSearch(event.target.value);
												classDirectory.setSearch("");
											}}
											placeholder="Collection ID"
										/>
										<CollectionDirectoryLookup
											collections={collectionDirectory.query.data?.items ?? []}
											helperText={directoryLookupStatus({
												count:
													collectionDirectory.query.data?.items.length ?? 0,
												isError: collectionDirectory.query.isError,
												isLoading: collectionDirectory.query.isLoading,
												isPartial: Boolean(
													collectionDirectory.query.data?.isPartial,
												),
												isReady: collectionDirectory.isReady,
												minimumLength: collectionDirectory.minimumLength,
												resourcePlural: "collections",
												resourceSingular: "collection",
												term: collectionDirectory.term,
											})}
											idPrefix="remote-target-collection-directory"
											onChange={collectionDirectory.setSearch}
											onSelect={(collection) => {
												patchFormState({
													collectionId: String(collection.id),
													classId: "",
												});
												classDirectory.setSearch("");
											}}
											value={collectionDirectory.search}
										/>
									</div>
									{selectedCollection ? (
										<small className="field-note">
											Selected: {selectedCollection.name} (#
											{selectedCollection.id})
										</small>
									) : null}
								</div>
							</div>
							<fieldset className="remote-subject-section">
								<legend>Subject types</legend>
								<div className="remote-subject-options">
									{REMOTE_TARGET_SUBJECT_TYPES.map((subjectType) => (
										<label key={subjectType} className="remote-subject-option">
											<input
												type="checkbox"
												name="remote-target-subject-type"
												checked={formState.allowedSubjectTypes.includes(
													subjectType,
												)}
												onChange={(event) =>
													toggleSubjectType(subjectType, event.target.checked)
												}
											/>
											<span>{subjectType.replaceAll("_", " ")}</span>
										</label>
									))}
								</div>
								<span className="field-note">
									Select every subject that can invoke this target.
								</span>
							</fieldset>
							{allowsObjects ? (
								<div className="control-field control-field--wide">
									<label htmlFor="remote-target-class">
										Object class scope
									</label>
									<div className="directory-id-lookup-control">
										<input
											id="remote-target-class"
											required
											type="number"
											min={1}
											value={formState.classId}
												onChange={(event) => {
													patchFormState({ classId: event.target.value });
													classDirectory.setSearch(event.target.value);
											}}
											placeholder="Class ID"
										/>
										<ClassDirectoryLookup
											classes={classDirectory.query.data?.items ?? []}
											disabled={
												!Number.isFinite(parsedCollectionId) ||
												parsedCollectionId < 1
											}
											disabledHint="Choose a collection first"
											helperText={directoryLookupStatus({
												count: classDirectory.query.data?.items.length ?? 0,
												isError: classDirectory.query.isError,
												isLoading: classDirectory.query.isLoading,
												isPartial: Boolean(
													classDirectory.query.data?.isPartial,
												),
												isReady: classDirectory.isReady,
												minimumLength: classDirectory.minimumLength,
												resourcePlural: "classes",
												resourceSingular: "class",
												scope: "in the selected collection",
												term: classDirectory.term,
											})}
											idPrefix="remote-target-class-directory"
											onChange={classDirectory.setSearch}
												onSelect={(hubuumClass) => {
													patchFormState({ classId: String(hubuumClass.id) });
												}}
											value={classDirectory.search}
										/>
									</div>
									<span className="field-note">
										{selectedClass
											? `Selected: ${selectedClass.name} (#${selectedClass.id}). `
											: ""}
										Object targets apply only to objects in this class.
									</span>
								</div>
							) : null}
							<GuidedFlowContinue
								disabled={!scopeReady}
								nextLabel="Request"
								onContinue={() => continueFrom("scope", "request")}
								summary={`${selectedCollection?.name ?? "Choose a collection"} · ${selectedSubjectTypes || "choose at least one subject"}${selectedClass ? ` · ${selectedClass.name}` : ""}`}
								title={
									scopeReady
										? "Scope ready"
										: "Choose where and for which subjects this target is available"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "request" ? (
						<GuidedFlowPanel stepId="request">
							<div className="form-grid">
								<label className="control-field">
									<span>Name</span>
									<input
										required
										value={formState.name}
										onChange={(event) =>
											patchFormState({ name: event.target.value })
										}
										placeholder="create-ticket"
									/>
								</label>
								<label className="control-field">
									<span>Method</span>
									<select
										value={formState.method}
										onChange={(event) =>
											patchFormState({
												method: event.target.value as RemoteHttpMethod,
											})
										}
									>
										{METHODS.map((method) => (
											<option key={method} value={method}>
												{method.toUpperCase()}
											</option>
										))}
									</select>
								</label>
								<label className="control-field control-field--wide">
									<span>Description</span>
									<input
										required
										value={formState.description}
										onChange={(event) =>
											patchFormState({ description: event.target.value })
										}
										placeholder="Create an external ticket for this subject"
									/>
								</label>
								<label className="control-field control-field--wide">
									<span>URL template</span>
									<input
										required
										value={formState.urlTemplate}
										onChange={(event) =>
											patchFormState({ urlTemplate: event.target.value })
										}
										placeholder="https://service.example.com/assets/{{ object.id }}"
									/>
								</label>
								<label className="control-field">
									<span>Timeout ms</span>
									<input
										type="number"
										min={1}
										value={formState.timeoutMs}
										onChange={(event) =>
											patchFormState({ timeoutMs: event.target.value })
										}
									/>
								</label>
							</div>
							<GuidedFlowContinue
								disabled={!requestReady}
								nextLabel="Templates"
								onBack={() => setActiveStep("scope")}
								onContinue={() => continueFrom("request", "templates")}
								summary={`${formState.method.toUpperCase()} ${formState.urlTemplate || "URL template"}`}
								title={
									requestReady
										? "Request ready"
										: "Describe the outbound request"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "templates" ? (
						<GuidedFlowPanel stepId="templates">
							<label className="control-field control-field--wide">
								<span>Headers template JSON</span>
								<textarea
									rows={7}
									value={formState.headersTemplateInput}
									onChange={(event) =>
										patchFormState({ headersTemplateInput: event.target.value })
									}
								/>
								<span className="field-note">
									Transport-controlled headers such as Host, Content-Length,
									Connection, and Transfer-Encoding are not allowed.
								</span>
							</label>
							<label className="control-field control-field--wide">
								<span>Body template (optional)</span>
								<textarea
									rows={8}
									value={formState.bodyTemplate}
									onChange={(event) =>
										patchFormState({ bodyTemplate: event.target.value })
									}
									placeholder='{"object_id":{{ object.id }}}'
								/>
								<span className="field-note">
									Leave blank for requests without a body.
								</span>
							</label>
							<GuidedFlowContinue
								disabled={!templatesReady}
								nextLabel="Authentication"
								onBack={() => setActiveStep("request")}
								onContinue={() => continueFrom("templates", "authentication")}
								summary={`${formState.headersTemplateInput.trim() === "{}" ? "No custom headers" : "Custom headers"} · ${formState.bodyTemplate.trim() ? "body template" : "no body"}`}
								title={
									templatesReady
										? "Templates ready"
										: "Fix the headers template JSON"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "authentication" ? (
						<GuidedFlowPanel stepId="authentication">
							<fieldset className="remote-subject-section">
								<legend>Authentication method</legend>
								<div className="remote-subject-options">
									{(
										[
											["none", "None"],
											["bearer_secret", "Bearer token"],
											["basic_secret", "Basic"],
											["api_key_secret", "API key"],
										] as const
									).map(([authType, label]) => (
										<label key={authType} className="remote-subject-option">
											<input
												type="radio"
												name="remote-target-auth-type"
												checked={formState.authType === authType}
												onChange={() => patchFormState({ authType })}
											/>
											<span>{label}</span>
										</label>
									))}
								</div>
							</fieldset>
							{formState.authType !== "none" ? (
								<div className="form-grid">
									{formState.authType === "basic_secret" ? (
										<label className="control-field">
											<span>Username</span>
											<input
												value={formState.authUsername}
												onChange={(event) =>
													patchFormState({ authUsername: event.target.value })
												}
											/>
										</label>
									) : null}
									{formState.authType === "api_key_secret" ? (
										<label className="control-field">
											<span>Header name</span>
											<input
												value={formState.authHeader}
												onChange={(event) =>
													patchFormState({ authHeader: event.target.value })
												}
												placeholder="X-API-Key"
											/>
										</label>
									) : null}
									<label className="control-field control-field--wide">
										<span>Secret reference</span>
										<input
											value={formState.authSecret}
											onChange={(event) =>
												patchFormState({ authSecret: event.target.value })
											}
											placeholder="remote-target-credential"
										/>
										<span className="field-note">
											Reference an externally managed secret; do not enter a
											credential value.
										</span>
									</label>
								</div>
							) : (
								<div className="info-banner">
									The request will be sent without an authorization credential.
								</div>
							)}
							<GuidedFlowContinue
								disabled={!authenticationReady}
								nextLabel="Review"
								onBack={() => setActiveStep("templates")}
								onContinue={() => continueFrom("authentication", "review")}
								summary={authenticationSummary}
								title={
									authenticationReady
										? "Authentication ready"
										: "Complete the secret reference details"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "review" ? (
						<GuidedFlowPanel stepId="review">
							<dl className="guided-flow-review-list">
								<div>
									<dt>Target</dt>
									<dd>
										{formState.name} ·{" "}
										{selectedCollection?.name ??
											`collection #${formState.collectionId}`}
									</dd>
								</div>
								<div>
									<dt>Subjects</dt>
									<dd>
										{selectedSubjectTypes || "None selected"}
										{selectedClass ? ` · ${selectedClass.name}` : ""}
									</dd>
								</div>
								<div>
									<dt>Request</dt>
									<dd>
										{formState.method.toUpperCase()} {formState.urlTemplate}
									</dd>
								</div>
								<div>
									<dt>Templates</dt>
									<dd>
										{formState.bodyTemplate.trim()
											? "Headers and body configured"
											: "Headers configured; no body"}
									</dd>
								</div>
								<div>
									<dt>Authentication</dt>
									<dd>{authenticationSummary}</dd>
								</div>
							</dl>
							<label className="control-check">
								<input
									type="checkbox"
									checked={formState.enabled}
									onChange={(event) =>
										patchFormState({ enabled: event.target.checked })
									}
								/>
								<span>Enable this target immediately</span>
							</label>
							<div className="form-actions">
								<button
									type="button"
									className="ghost"
									onClick={() => setActiveStep("authentication")}
									disabled={isSaving}
								>
									Back
								</button>
								<button
									type="submit"
									disabled={isSaving || !authenticationReady}
								>
									{isSaving
										? "Saving..."
										: formMode === "edit"
											? "Save target"
											: "Create target"}
								</button>
							</div>
						</GuidedFlowPanel>
					) : null}

					{formError ? <div className="error-banner">{formError}</div> : null}
				</form>
			</CreateModal>

			<div className="card stack resource-index">
				<div className="table-header">
					<ResourceIndexHeading
						title="Remote targets"
						summary={resourceSummary}
						createSection="admin-remote-targets"
						createLabel="New remote target"
					/>
					<div className="table-tools">
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search targets"
						/>
						<TableExportMenu
							view={targetExportView}
							disabled={loadTargetsMutation.isPending}
							compact
						/>
					</div>
				</div>

				{tableError ? <div className="error-banner">{tableError}</div> : null}
				{tableSuccess ? <div className="muted">{tableSuccess}</div> : null}
				{collectionsQuery.isError ? (
					<div className="muted">
						Could not load collection names. Collection IDs are still shown.
					</div>
				) : null}
				{classesQuery.isError ? (
					<div className="muted">
						Could not load class names. Class IDs are still shown.
					</div>
				) : null}

				{loadTargetsMutation.isPending && targets.length === 0 ? (
					<div className="muted">Loading remote targets...</div>
				) : null}
				{!loadTargetsMutation.isPending && visibleTargets.length === 0 ? (
					<div className="empty-state">No remote targets match this view.</div>
				) : null}

				{visibleTargets.length > 0 ? (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Name</th>
									<th>Collection</th>
									<th>Method</th>
									<th>Subject</th>
									<th>Class scope</th>
									<th>Enabled</th>
									<th>Updated</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{visibleTargets.map((target) => (
									<tr key={target.id}>
										<td>
											<strong>{target.name}</strong>
											<div className="muted">{target.description}</div>
										</td>
										<td>
											{collectionsById.get(target.collection_id)?.name ??
												`#${target.collection_id}`}
										</td>
										<td>{target.method.toUpperCase()}</td>
										<td>{target.allowed_subject_types.join(", ")}</td>
										<td>
											{target.class_id == null
												? "n/a"
												: (classesById.get(target.class_id)?.name ??
													`#${target.class_id}`)}
										</td>
										<td>{target.enabled ? "yes" : "no"}</td>
										<td>{formatTimestamp(target.updated_at)}</td>
										<td>
											<div className="action-row">
												<button
													type="button"
													className="ghost"
													onClick={() => openEditModal(target)}
												>
													Edit
												</button>
												<button
													type="button"
													className="danger"
													onClick={() => onDelete(target)}
													disabled={deleteMutation.isPending}
												>
													Delete
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}

				{nextCursor ? (
					<div className="form-actions">
						<button
							type="button"
							className="ghost"
							onClick={() => loadTargetsMutation.mutate(nextCursor)}
							disabled={loadTargetsMutation.isPending}
						>
							{loadTargetsMutation.isPending ? "Loading..." : "Load more"}
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
