"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1RemoteTargetsByTargetId,
	getApiV1Classes,
	getApiV1Namespaces,
	patchApiV1RemoteTargetsByTargetId,
	postApiV1RemoteTargets,
} from "@/lib/api/generated/client";
import type {
	HubuumClassExpanded,
	Namespace,
	NewRemoteTarget,
	RemoteAuthConfig,
	RemoteHttpMethod,
	RemoteTarget,
	RemoteTargetSubjectType,
	UpdateRemoteTarget,
} from "@/lib/api/generated/models";
import {
	fetchRemoteTargetsPage,
	isPlainObject,
	parseJsonObjectInput,
} from "@/lib/api/remote-targets";
import {
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
} from "@/lib/create-events";

const METHODS: RemoteHttpMethod[] = ["get", "post", "patch", "delete"];
const SUBJECT_TYPES: RemoteTargetSubjectType[] = [
	"namespace",
	"class",
	"object",
	"class_relation",
	"object_relation",
];

type FormMode = "create" | "edit";

type FormState = {
	allowedSubjectTypes: RemoteTargetSubjectType[];
	authConfigInput: string;
	bodyTemplate: string;
	classId: string;
	description: string;
	enabled: boolean;
	headersTemplateInput: string;
	method: RemoteHttpMethod;
	name: string;
	namespaceId: string;
	timeoutMs: string;
	urlTemplate: string;
};

const defaultFormState: FormState = {
	allowedSubjectTypes: ["object"],
	authConfigInput: '{\n  "type": "none"\n}',
	bodyTemplate: "",
	classId: "",
	description: "",
	enabled: true,
	headersTemplateInput: "{}",
	method: "post",
	name: "",
	namespaceId: "",
	timeoutMs: "5000",
	urlTemplate: "https://example.com/{{ object.id }}",
};

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
		{ limit: 250, sort: "name.asc,id.asc" },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
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
	return {
		allowedSubjectTypes: [target.allowed_subject_types[0] ?? "object"],
		authConfigInput: stringifyJson(target.auth_config),
		bodyTemplate: target.body_template ?? "",
		classId: target.class_id == null ? "" : String(target.class_id),
		description: target.description,
		enabled: target.enabled,
		headersTemplateInput: stringifyJson(target.headers_template),
		method: target.method,
		name: target.name,
		namespaceId: String(target.namespace_id),
		timeoutMs: String(target.timeout_ms),
		urlTemplate: target.url_template,
	};
}

function isRemoteAuthConfig(value: unknown): value is RemoteAuthConfig {
	if (!isPlainObject(value) || typeof value.type !== "string") {
		return false;
	}

	if (value.type === "none") {
		return true;
	}
	if (value.type === "bearer_secret") {
		return typeof value.secret === "string" && value.secret.trim() !== "";
	}
	if (value.type === "basic_secret") {
		return (
			typeof value.username === "string" &&
			value.username.trim() !== "" &&
			typeof value.secret === "string" &&
			value.secret.trim() !== ""
		);
	}
	if (value.type === "api_key_secret") {
		return (
			typeof value.header === "string" &&
			value.header.trim() !== "" &&
			typeof value.secret === "string" &&
			value.secret.trim() !== ""
		);
	}

	return false;
}

function buildPayload(state: FormState): NewRemoteTarget {
	const namespaceId = Number.parseInt(state.namespaceId, 10);
	if (!Number.isFinite(namespaceId) || namespaceId < 1) {
		throw new Error("Namespace is required.");
	}

	const name = state.name.trim();
	if (!name) {
		throw new Error("Name is required.");
	}

	const description = state.description.trim();
	if (!description) {
		throw new Error("Description is required.");
	}

	const urlTemplate = state.urlTemplate.trim();
	if (!urlTemplate) {
		throw new Error("URL template is required.");
	}

	if (state.allowedSubjectTypes.length !== 1) {
		throw new Error("Select one subject type.");
	}
	const subjectType = state.allowedSubjectTypes[0];
	const classIdText = state.classId.trim();
	let classId: number | null = null;
	if (subjectType === "object") {
		classId = Number.parseInt(classIdText, 10);
		if (!Number.isFinite(classId) || classId < 1) {
			throw new Error("Class scope is required for object targets.");
		}
	} else if (classIdText) {
		throw new Error("Class scope is only valid for object targets.");
	}

	const headersTemplate = parseJsonObjectInput(
		state.headersTemplateInput,
		"Headers template",
	);
	const authConfig = parseJsonObjectInput(state.authConfigInput, "Auth config");
	if (!isRemoteAuthConfig(authConfig)) {
		throw new Error("Auth config must match a supported remote auth shape.");
	}

	const payload: NewRemoteTarget = {
		allowed_subject_types: state.allowedSubjectTypes,
		auth_config: authConfig,
		description,
		enabled: state.enabled,
		headers_template: headersTemplate,
		method: state.method,
		name,
		namespace_id: namespaceId,
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
		if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
			throw new Error("Timeout must be a positive integer.");
		}
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

	const namespacesQuery = useQuery({
		queryKey: ["namespaces", "admin-remote-targets"],
		queryFn: fetchNamespaces,
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "admin-remote-targets"],
		queryFn: fetchClasses,
	});

	const loadTargetsMutation = useMutation({
		mutationFn: async (cursor?: string | null) =>
			fetchRemoteTargetsPage({ cursor: cursor ?? undefined, limit: 100 }),
		onSuccess: (page, cursor) => {
			setTargets((current) => (cursor ? [...current, ...page.targets] : page.targets));
			setNextCursor(page.nextCursor);
			setTableError(null);
		},
		onError: (error) => {
			setTableError(
				error instanceof Error ? error.message : "Failed to load remote targets.",
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
			await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
			setModalOpen(false);
			setTableSuccess("Remote target created.");
			setTableError(null);
			loadTargetsMutation.mutate(null);
		},
		onError: (error) => {
			setFormError(
				error instanceof Error ? error.message : "Failed to create remote target.",
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
				error instanceof Error ? error.message : "Failed to update remote target.",
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
				error instanceof Error ? error.message : "Failed to delete remote target.",
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
		const namespaces = namespacesQuery.data ?? [];
		if (formState.namespaceId || namespaces.length !== 1) {
			return;
		}

		setFormState((current) => ({
			...current,
			namespaceId: String(namespaces[0].id),
		}));
	}, [formState.namespaceId, namespacesQuery.data]);

	const namespacesById = useMemo(() => {
		return new Map((namespacesQuery.data ?? []).map((namespace) => [namespace.id, namespace]));
	}, [namespacesQuery.data]);
	const classesById = useMemo(() => {
		return new Map((classesQuery.data ?? []).map((hubuumClass) => [hubuumClass.id, hubuumClass]));
	}, [classesQuery.data]);
	const classOptions = useMemo(() => {
		const namespaceId = Number.parseInt(formState.namespaceId, 10);
		if (!Number.isFinite(namespaceId)) {
			return [];
		}

		return (classesQuery.data ?? []).filter(
			(hubuumClass) => hubuumClass.namespace.id === namespaceId,
		);
	}, [classesQuery.data, formState.namespaceId]);
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
				String(target.namespace_id),
				namespacesById.get(target.namespace_id)?.name ?? "",
				target.class_id == null ? "" : String(target.class_id),
				target.class_id == null ? "" : classesById.get(target.class_id)?.name ?? "",
				target.allowed_subject_types.join(" "),
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(needle);
		});
	}, [classesById, namespacesById, search, targets]);

	function openCreateModal() {
		setFormMode("create");
		setEditingTarget(null);
		setFormError(null);
		setFormState({
			...defaultFormState,
			namespaceId:
				namespacesQuery.data?.length === 1
					? String(namespacesQuery.data[0].id)
					: "",
		});
		setModalOpen(true);
	}

	function openEditModal(target: RemoteTarget) {
		setFormMode("edit");
		setEditingTarget(target);
		setFormError(null);
		setFormState(formStateFromTarget(target));
		setModalOpen(true);
	}

	function selectSubjectType(subjectType: RemoteTargetSubjectType) {
		setFormState((current) => {
			return {
				...current,
				allowedSubjectTypes: [subjectType],
				classId: subjectType === "object" ? current.classId : "",
			};
		});
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
				if (!selectedClass || selectedClass.namespace.id !== payload.namespace_id) {
					setFormError("Class scope must belong to the selected namespace.");
					return;
				}
			}
		} catch (error) {
			setFormError(error instanceof Error ? error.message : "Invalid form data.");
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

	return (
		<div className="stack">
			<CreateModal
				open={isModalOpen}
				title={formMode === "edit" ? "Edit remote target" : "Create remote target"}
				onClose={() => setModalOpen(false)}
			>
				<form className="stack" onSubmit={onSubmit}>
					<div className="form-grid">
						<label className="control-field" htmlFor="remote-target-namespace">
							<span>Namespace</span>
							{namespacesQuery.data?.length ? (
								<select
									id="remote-target-namespace"
									required
									value={formState.namespaceId}
									onChange={(event) =>
										setFormState((current) => ({
											...current,
											namespaceId: event.target.value,
										}))
									}
								>
									<option value="">Select a namespace</option>
									{namespacesQuery.data.map((namespace) => (
										<option key={namespace.id} value={namespace.id}>
											{namespace.name}
										</option>
									))}
								</select>
							) : (
								<input
									id="remote-target-namespace"
									required
									type="number"
									min={1}
									value={formState.namespaceId}
									onChange={(event) =>
										setFormState((current) => ({
											...current,
											namespaceId: event.target.value,
										}))
									}
									placeholder="Namespace ID"
								/>
							)}
						</label>

						<label className="control-field">
							<span>Name</span>
							<input
								required
								value={formState.name}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder="create-ticket"
							/>
						</label>

						<label className="control-field control-field--wide">
							<span>Description</span>
							<input
								required
								value={formState.description}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										description: event.target.value,
									}))
								}
								placeholder="Create an external ticket for this subject"
							/>
						</label>

						<label className="control-field">
							<span>Method</span>
							<select
								value={formState.method}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										method: event.target.value as RemoteHttpMethod,
									}))
								}
							>
								{METHODS.map((method) => (
									<option key={method} value={method}>
										{method.toUpperCase()}
									</option>
								))}
							</select>
						</label>

						<label className="control-field">
							<span>Timeout ms</span>
							<input
								type="number"
								min={1}
								value={formState.timeoutMs}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										timeoutMs: event.target.value,
									}))
								}
							/>
						</label>

						<label className="control-field control-field--wide">
							<span>URL template</span>
							<input
								required
								value={formState.urlTemplate}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										urlTemplate: event.target.value,
									}))
								}
								placeholder="https://service.example.com/assets/{{ object.id }}"
							/>
						</label>

						{formState.allowedSubjectTypes.includes("object") ? (
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
											setFormState((current) => ({
												...current,
												classId: event.target.value,
											}))
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
											setFormState((current) => ({
												...current,
												classId: event.target.value,
											}))
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
					</div>

					<div className="remote-subject-section">
						<h4>Subject type</h4>
						<div className="remote-subject-options">
							{SUBJECT_TYPES.map((subjectType) => (
								<label key={subjectType} className="remote-subject-option">
									<input
										type="radio"
										name="remote-target-subject-type"
										checked={formState.allowedSubjectTypes.includes(subjectType)}
										onChange={() => selectSubjectType(subjectType)}
									/>
									<span>{subjectType.replaceAll("_", " ")}</span>
								</label>
							))}
						</div>
					</div>

					<div className="form-grid">
						<label className="control-field control-field--wide">
							<span>Headers template JSON</span>
							<textarea
								rows={5}
								value={formState.headersTemplateInput}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										headersTemplateInput: event.target.value,
									}))
								}
							/>
						</label>

						<label className="control-field control-field--wide">
							<span>Auth config JSON</span>
							<textarea
								rows={5}
								value={formState.authConfigInput}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										authConfigInput: event.target.value,
									}))
								}
							/>
						</label>

						<label className="control-field control-field--wide">
							<span>Body template</span>
							<textarea
								rows={5}
								value={formState.bodyTemplate}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										bodyTemplate: event.target.value,
									}))
								}
								placeholder='{"object_id":{{ object.id }}}'
							/>
						</label>
					</div>

					<label className="control-check">
						<input
							type="checkbox"
							checked={formState.enabled}
							onChange={(event) =>
								setFormState((current) => ({
									...current,
									enabled: event.target.checked,
								}))
							}
						/>
						<span>Enabled</span>
					</label>

					{formError ? <div className="error-banner">{formError}</div> : null}

					<div className="form-actions">
						<button type="submit" disabled={isSaving}>
							{isSaving
								? "Saving..."
								: formMode === "edit"
									? "Save target"
									: "Create target"}
						</button>
						<button
							type="button"
							className="ghost"
							onClick={() => setModalOpen(false)}
							disabled={isSaving}
						>
							Cancel
						</button>
					</div>
				</form>
			</CreateModal>

			<div className="card table-wrap">
				<div className="table-header">
					<h3>Remote targets</h3>
					<div className="table-tools">
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search targets"
						/>
						<button type="button" onClick={openCreateModal}>
							Create target
						</button>
					</div>
				</div>

				{tableError ? <div className="error-banner">{tableError}</div> : null}
				{tableSuccess ? <div className="muted">{tableSuccess}</div> : null}
				{namespacesQuery.isError ? (
					<div className="muted">
						Could not load namespace names. Namespace IDs are still shown.
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
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Namespace</th>
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
										{namespacesById.get(target.namespace_id)?.name ??
											`#${target.namespace_id}`}
									</td>
									<td>{target.method.toUpperCase()}</td>
									<td>{target.allowed_subject_types.join(", ")}</td>
									<td>
										{target.class_id == null
											? "n/a"
											: classesById.get(target.class_id)?.name ??
												`#${target.class_id}`}
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
