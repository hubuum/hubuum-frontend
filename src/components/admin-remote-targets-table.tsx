"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import { TableExportMenu } from "@/components/table-export-menu";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1RemoteTargetsByTargetId,
	getApiV1Classes,
	getApiV1Collections,
	patchApiV1RemoteTargetsByTargetId,
	postApiV1RemoteTargets,
} from "@/lib/api/generated/client";
import type {
	Collection,
	HubuumClassExpanded,
	NewRemoteTarget,
	RemoteAuthConfig,
	RemoteHttpMethod,
	RemoteTarget,
	RemoteTargetSubjectType,
	UpdateRemoteTarget,
} from "@/lib/api/generated/models";
import {
	fetchRemoteTargetsPage,
	parseJsonObjectInput,
} from "@/lib/api/remote-targets";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
} from "@/lib/collection-hierarchy";
import {
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
} from "@/lib/create-events";
import type { TableExportView } from "@/lib/table-export";

const METHODS: RemoteHttpMethod[] = ["get", "post", "patch", "delete"];
const SUBJECT_TYPES: RemoteTargetSubjectType[] = [
	"collection",
	"class",
	"object",
	"class_relation",
	"object_relation",
];

type FormMode = "create" | "edit";

const REMOTE_TARGET_STEPS = [
	{ id: "scope", label: "Scope", hint: "Collection and subject" },
	{ id: "request", label: "Request", hint: "Endpoint and method" },
	{ id: "templates", label: "Templates", hint: "Headers and body" },
	{ id: "authentication", label: "Authentication", hint: "Secret references" },
	{ id: "review", label: "Review", hint: "Confirm and save" },
] as const;

type RemoteTargetStep = (typeof REMOTE_TARGET_STEPS)[number]["id"];
type RemoteAuthType = RemoteAuthConfig["type"];

type FormState = {
	allowedSubjectTypes: RemoteTargetSubjectType[];
	authHeader: string;
	authSecret: string;
	authType: RemoteAuthType;
	authUsername: string;
	bodyTemplate: string;
	classId: string;
	description: string;
	enabled: boolean;
	headersTemplateInput: string;
	method: RemoteHttpMethod;
	name: string;
	collectionId: string;
	timeoutMs: string;
	urlTemplate: string;
};

const defaultFormState: FormState = {
	allowedSubjectTypes: ["object"],
	authHeader: "X-API-Key",
	authSecret: "",
	authType: "none",
	authUsername: "",
	bodyTemplate: "",
	classId: "",
	description: "",
	enabled: true,
	headersTemplateInput: "{}",
	method: "post",
	name: "",
	collectionId: "",
	timeoutMs: "5000",
	urlTemplate: "https://example.com/{{ object.id }}",
};

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections(
		{ include_total: false },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}

	return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ limit: 250, sort: "name.asc,id.asc", include_total: false },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	return response.data;
}

function formatTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
}

function stringifyJson(value: unknown): string {
	return JSON.stringify(value ?? {}, null, 2) ?? "{}";
}

function formStateFromTarget(target: RemoteTarget): FormState {
	const authConfig = target.auth_config;
	return {
		allowedSubjectTypes: [target.allowed_subject_types[0] ?? "object"],
		authHeader: "header" in authConfig ? authConfig.header : "X-API-Key",
		authSecret: "secret" in authConfig ? authConfig.secret : "",
		authType: authConfig.type,
		authUsername: "username" in authConfig ? authConfig.username : "",
		bodyTemplate: target.body_template ?? "",
		classId: target.class_id == null ? "" : String(target.class_id),
		description: target.description,
		enabled: target.enabled,
		headersTemplateInput: stringifyJson(target.headers_template),
		method: target.method,
		name: target.name,
		collectionId: String(target.collection_id),
		timeoutMs: String(target.timeout_ms),
		urlTemplate: target.url_template,
	};
}

function buildAuthConfig(state: FormState): RemoteAuthConfig {
	if (state.authType === "none") return { type: "none" };

	const secret = state.authSecret.trim();
	if (!secret) throw new Error("Secret reference is required.");
	if (state.authType === "bearer_secret") {
		return { type: "bearer_secret", secret };
	}
	if (state.authType === "basic_secret") {
		const username = state.authUsername.trim();
		if (!username)
			throw new Error("Basic authentication username is required.");
		return { type: "basic_secret", secret, username };
	}

	const header = state.authHeader.trim();
	if (!header) throw new Error("API key header is required.");
	return { type: "api_key_secret", header, secret };
}

function validateScope(state: FormState): void {
	const collectionId = Number.parseInt(state.collectionId, 10);
	if (!Number.isFinite(collectionId) || collectionId < 1) {
		throw new Error("Collection is required.");
	}
	if (state.allowedSubjectTypes.length !== 1) {
		throw new Error("Select one subject type.");
	}
	const classIdText = state.classId.trim();
	if (state.allowedSubjectTypes[0] === "object") {
		const classId = Number.parseInt(classIdText, 10);
		if (!Number.isFinite(classId) || classId < 1) {
			throw new Error("Class scope is required for object targets.");
		}
	} else if (classIdText) {
		throw new Error("Class scope is only valid for object targets.");
	}
}

function validateRequest(state: FormState): void {
	if (!state.name.trim()) throw new Error("Name is required.");
	if (!state.description.trim()) throw new Error("Description is required.");
	if (!state.urlTemplate.trim()) throw new Error("URL template is required.");
	if (state.timeoutMs.trim()) {
		const timeoutMs = Number.parseInt(state.timeoutMs, 10);
		if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
			throw new Error("Timeout must be a positive integer.");
		}
	}
}

function validateTemplates(state: FormState): void {
	parseJsonObjectInput(state.headersTemplateInput, "Headers template");
}

function buildPayload(state: FormState): NewRemoteTarget {
	validateScope(state);
	validateRequest(state);
	validateTemplates(state);
	const collectionId = Number.parseInt(state.collectionId, 10);
	const name = state.name.trim();
	const description = state.description.trim();
	const urlTemplate = state.urlTemplate.trim();
	const subjectType = state.allowedSubjectTypes[0];
	const classIdText = state.classId.trim();
	let classId: number | null = null;
	if (subjectType === "object") {
		classId = Number.parseInt(classIdText, 10);
	}

	const headersTemplate = parseJsonObjectInput(
		state.headersTemplateInput,
		"Headers template",
	);
	const authConfig = buildAuthConfig(state);

	const payload: NewRemoteTarget = {
		allowed_subject_types: state.allowedSubjectTypes,
		auth_config: authConfig,
		description,
		enabled: state.enabled,
		headers_template: headersTemplate,
		method: state.method,
		name,
		collection_id: collectionId,
		url_template: urlTemplate,
	};
	payload.class_id = classId;

	const bodyTemplate = state.bodyTemplate.trim();
	if (bodyTemplate) {
		payload.body_template = bodyTemplate;
	} else {
		payload.body_template = null;
	}

	const timeoutText = state.timeoutMs.trim();
	if (timeoutText) {
		const timeoutMs = Number.parseInt(timeoutText, 10);
		payload.timeout_ms = timeoutMs;
	}

	return payload;
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
	const [formState, setFormState] = useState<FormState>(defaultFormState);
	const [activeStep, setActiveStep] = useState<RemoteTargetStep>("scope");

	const collectionsQuery = useQuery({
		queryKey: ["collections", "admin-remote-targets"],
		queryFn: fetchCollections,
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "admin-remote-targets"],
		queryFn: fetchClasses,
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

	useEffect(() => {
		const collections = collectionsQuery.data ?? [];
		if (formState.collectionId || collections.length !== 1) {
			return;
		}

		setFormState((current) => ({
			...current,
			collectionId: String(collections[0].id),
		}));
	}, [formState.collectionId, collectionsQuery.data]);

	const collectionsById = useMemo(() => {
		return new Map(
			(collectionsQuery.data ?? []).map((collection) => [
				collection.id,
				collection,
			]),
		);
	}, [collectionsQuery.data]);
	const collectionHierarchy = useMemo(
		() => buildCollectionHierarchy(collectionsQuery.data ?? []),
		[collectionsQuery.data],
	);
	const classesById = useMemo(() => {
		return new Map(
			(classesQuery.data ?? []).map((hubuumClass) => [
				hubuumClass.id,
				hubuumClass,
			]),
		);
	}, [classesQuery.data]);
	const classOptions = useMemo(() => {
		const collectionId = Number.parseInt(formState.collectionId, 10);
		if (!Number.isFinite(collectionId)) {
			return [];
		}

		return (classesQuery.data ?? []).filter(
			(hubuumClass) => hubuumClass.collection.id === collectionId,
		);
	}, [classesQuery.data, formState.collectionId]);
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

	function openCreateModal() {
		setFormMode("create");
		setEditingTarget(null);
		setFormError(null);
		setFormState({
			...defaultFormState,
			collectionId:
				collectionsQuery.data?.length === 1
					? String(collectionsQuery.data[0].id)
					: "",
		});
		setActiveStep("scope");
		setModalOpen(true);
	}

	function openEditModal(target: RemoteTarget) {
		setFormMode("edit");
		setEditingTarget(target);
		setFormError(null);
		setFormState(formStateFromTarget(target));
		setActiveStep("scope");
		setModalOpen(true);
	}

	function selectSubjectType(subjectType: RemoteTargetSubjectType) {
		setFormError(null);
		setFormState((current) => {
			return {
				...current,
				allowedSubjectTypes: [subjectType],
				classId: subjectType === "object" ? current.classId : "",
			};
		});
	}

	function patchFormState(patch: Partial<FormState>) {
		setFormState((current) => ({ ...current, ...patch }));
		setFormError(null);
	}

	function getStepError(step: RemoteTargetStep): string | null {
		try {
			if (step === "scope") {
				validateScope(formState);
				if (formState.allowedSubjectTypes[0] === "object") {
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
				validateRequest(formState);
				return null;
			}
			if (step === "templates") {
				validateTemplates(formState);
				return null;
			}
			if (step === "authentication") {
				buildAuthConfig(formState);
				return null;
			}
			buildPayload(formState);
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
			payload = buildPayload(formState);
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
	const selectedSubjectType = formState.allowedSubjectTypes[0];
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
								<label
									className="control-field"
									htmlFor="remote-target-collection"
								>
									<span>Collection</span>
									{collectionsQuery.data?.length ? (
										<select
											id="remote-target-collection"
											required
											value={formState.collectionId}
											onChange={(event) =>
												patchFormState({
													collectionId: event.target.value,
													classId: "",
												})
											}
										>
											<option value="">Select a collection</option>
											{collectionsQuery.data.map((collection) => (
												<option key={collection.id} value={collection.id}>
													{formatCollectionOption(
														collection,
														collectionHierarchy.byId,
													)}
												</option>
											))}
										</select>
									) : (
										<input
											id="remote-target-collection"
											required
											type="number"
											min={1}
											value={formState.collectionId}
											onChange={(event) =>
												patchFormState({
													collectionId: event.target.value,
													classId: "",
												})
											}
											placeholder="Collection ID"
										/>
									)}
								</label>
							</div>
							<fieldset className="remote-subject-section">
								<legend>Subject type</legend>
								<div className="remote-subject-options">
									{SUBJECT_TYPES.map((subjectType) => (
										<label key={subjectType} className="remote-subject-option">
											<input
												type="radio"
												name="remote-target-subject-type"
												checked={formState.allowedSubjectTypes.includes(
													subjectType,
												)}
												onChange={() => selectSubjectType(subjectType)}
											/>
											<span>{subjectType.replaceAll("_", " ")}</span>
										</label>
									))}
								</div>
							</fieldset>
							{selectedSubjectType === "object" ? (
								<label
									className="control-field control-field--wide"
									htmlFor="remote-target-class"
								>
									<span>Object class scope</span>
									{classOptions.length > 0 ? (
										<select
											id="remote-target-class"
											required
											value={formState.classId}
											onChange={(event) =>
												patchFormState({ classId: event.target.value })
											}
										>
											<option value="">Select a class</option>
											{classOptions.map((hubuumClass) => (
												<option key={hubuumClass.id} value={hubuumClass.id}>
													{hubuumClass.name}
												</option>
											))}
										</select>
									) : (
										<input
											id="remote-target-class"
											required
											type="number"
											min={1}
											value={formState.classId}
											onChange={(event) =>
												patchFormState({ classId: event.target.value })
											}
											placeholder={
												classesQuery.isLoading
													? "Loading classes..."
													: "Class ID"
											}
										/>
									)}
									<span className="field-note">
										Object targets apply only to objects in this class.
									</span>
								</label>
							) : null}
							<GuidedFlowContinue
								disabled={!scopeReady}
								nextLabel="Request"
								onContinue={() => continueFrom("scope", "request")}
								summary={`${selectedCollection?.name ?? "Choose a collection"} · ${selectedSubjectType?.replaceAll("_", " ") ?? "choose a subject"}${selectedClass ? ` · ${selectedClass.name}` : ""}`}
								title={
									scopeReady
										? "Scope ready"
										: "Choose where and for which subject this target is available"
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
									<dt>Subject</dt>
									<dd>
										{selectedSubjectType?.replaceAll("_", " ")}
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

			<div className="card stack">
				<div className="table-header">
					<h3>Remote targets</h3>
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
						<button type="button" onClick={openCreateModal}>
							Create target
						</button>
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
