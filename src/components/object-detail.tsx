"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { EmptyState } from "@/components/empty-state";
import { JsonEditor } from "@/components/json-editor";
import { JsonViewer } from "@/components/json-viewer";
import { ObjectDetailTracker } from "@/components/object-detail-tracker";
import { RemoteInvocationsPanel } from "@/components/remote-invocations-panel";
import { ResourceActivityPanel } from "@/components/resource-activity-panel";
import { useConfirm } from "@/lib/confirm-context";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1ClassesByClassIdByObjectId,
	getApiV1Classes,
	getApiV1ClassesByClassIdByObjectId,
	getApiV1IamMeGroups,
	getApiV1Collections,
	getApiV1CollectionsByCollectionIdPermissions,
	patchApiV1ClassesByClassIdByObjectId,
} from "@/lib/api/generated/client";
import type {
	GroupPermission,
	HubuumClassExpanded,
	HubuumObject,
	HubuumObjectWithPath,
	Collection,
	UpdateHubuumObject,
} from "@/lib/api/generated/models";
import type { ConsoleGroup } from "@/lib/identity-scopes";
import {
	EDIT_STATE_EVENT,
	type EditStateEventDetail,
	TITLE_STATE_EVENT,
} from "@/lib/create-events";

type ObjectDetailProps = {
	classId: number;
	objectId: number;
	currentUsername: string | null;
	canEditAnything: boolean;
};

type EditableField = "name" | "description" | "collection" | "data";

const ALL_EDITABLE_FIELDS: EditableField[] = [
	"name",
	"description",
	"collection",
	"data",
];

async function fetchObject(
	classId: number,
	objectId: number,
): Promise<HubuumObject> {
	const response = await getApiV1ClassesByClassIdByObjectId(classId, objectId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load object."),
		);
	}

	return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	return response.data;
}

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}

	return response.data;
}

async function fetchCollectionPermissions(
	collectionId: number,
): Promise<GroupPermission[]> {
	const response = await getApiV1CollectionsByCollectionIdPermissions(
		collectionId,
		undefined,
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to load collection permissions.",
			),
		);
	}

	return response.data;
}

async function fetchCurrentUserGroups(
	_username: string,
): Promise<ConsoleGroup[]> {
	try {
		const response = await getApiV1IamMeGroups(undefined, {
			credentials: "include",
		});
		if (response.status !== 200) {
			return [];
		}
		return response.data;
	} catch {
		return [];
	}
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

async function fetchRelatedObjects(
	classId: number,
	objectId: number,
	depthLimit: number,
	includeSelfClass: boolean,
	ignoredClassIds: number[],
): Promise<HubuumObjectWithPath[]> {
	const params = new URLSearchParams({
		limit: "250",
		sort: "path.asc,id.asc",
		depth__lte: String(depthLimit),
		ignore_self_class: String(!includeSelfClass),
	});
	if (ignoredClassIds.length) {
		params.set("ignore_classes", ignoredClassIds.join(","));
	}
	const response = await fetch(
		`/_hubuum-bff/hubuum/api/v1/classes/${classId}/objects/${objectId}/related/objects?${params.toString()}`,
		{
			credentials: "include",
		},
	);
	const payload = await parseJsonPayload(response);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to load related objects."),
		);
	}

	return expectArrayPayload<HubuumObjectWithPath>(payload, "related objects");
}

function stringifyJson(value: unknown): string {
	const formatted = JSON.stringify(value, null, 2);
	return formatted ?? "null";
}

function normalizePermissionFlag(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		return value === 1;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "true" || normalized === "t" || normalized === "1";
	}

	return false;
}

function canCurrentUserUpdateObject(
	permissionEntries: GroupPermission[],
	currentUserGroups: ConsoleGroup[],
): boolean {
	const currentUserGroupIds = new Set(
		currentUserGroups.map((group) => group.id),
	);
	return permissionEntries.some(
		(entry) =>
			currentUserGroupIds.has(entry.group.id) &&
			normalizePermissionFlag(entry.permission.has_update_object),
	);
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

export function ObjectDetail({
	classId,
	objectId,
	currentUsername,
	canEditAnything,
}: ObjectDetailProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const ignoreClassesRef = useRef<HTMLDivElement | null>(null);

	const [relationDepthLimit, setRelationDepthLimit] = useState(2);
	const [includeSelfClass, setIncludeSelfClass] = useState(false);
	const [ignoredClassIds, setIgnoredClassIds] = useState<number[]>([]);
	const [isIgnoreClassesOpen, setIgnoreClassesOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [dataInput, setDataInput] = useState("{}");
	const [collectionId, setCollectionId] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [editingFields, setEditingFields] = useState<EditableField[]>([]);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const objectQuery = useQuery({
		queryKey: ["object", classId, objectId],
		queryFn: async () => fetchObject(classId, objectId),
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "object-detail"],
		queryFn: fetchClasses,
	});
	const collectionsQuery = useQuery({
		queryKey: ["collections", "object-detail"],
		queryFn: fetchCollections,
	});
	const collectionPermissionsQuery = useQuery({
		queryKey: [
			"collection",
			objectQuery.data?.collection_id,
			"permissions",
			"object-detail",
		],
		queryFn: async () => {
			if (!objectQuery.data) {
				return [];
			}

			return fetchCollectionPermissions(objectQuery.data.collection_id);
		},
		enabled: Boolean(objectQuery.data) && !canEditAnything,
	});
	const currentUserGroupsQuery = useQuery({
		queryKey: [
			"permissions",
			"current-user-groups",
			currentUsername,
			"object-detail",
		],
		queryFn: async () => {
			if (!currentUsername) {
				return [];
			}

			return fetchCurrentUserGroups(currentUsername);
		},
		enabled: Boolean(currentUsername) && !canEditAnything,
	});
	const relatedObjectsQuery = useQuery({
		queryKey: [
			"object-related-objects",
			"detail",
			classId,
			objectId,
			relationDepthLimit,
			includeSelfClass,
			ignoredClassIds,
		],
		queryFn: async () =>
			fetchRelatedObjects(
				classId,
				objectId,
				relationDepthLimit,
				includeSelfClass,
				ignoredClassIds,
			),
	});

	useEffect(() => {
		if (!objectQuery.data) {
			return;
		}

		if (!initialized || editingFields.length === 0) {
			setName(objectQuery.data.name);
			setDescription(objectQuery.data.description ?? "");
			setDataInput(stringifyJson(objectQuery.data.data));
			setCollectionId(String(objectQuery.data.collection_id));
			setInitialized(true);
		}
	}, [editingFields.length, initialized, objectQuery.data]);

	useEffect(() => {
		if (!isIgnoreClassesOpen) {
			return;
		}

		function handlePointerDown(event: MouseEvent) {
			if (!ignoreClassesRef.current?.contains(event.target as Node)) {
				setIgnoreClassesOpen(false);
			}
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setIgnoreClassesOpen(false);
			}
		}

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isIgnoreClassesOpen]);

	const collections = collectionsQuery.data ?? [];

	const updateMutation = useMutation({
		mutationFn: async (payload: UpdateHubuumObject) => {
			const response = await patchApiV1ClassesByClassIdByObjectId(
				classId,
				objectId,
				payload,
				{
					credentials: "include",
				},
			);

			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to update object."),
				);
			}

			return response.data;
		},
		onSuccess: async (updatedObject) => {
			const targetClassId = updatedObject.hubuum_class_id;
			await queryClient.invalidateQueries({
				queryKey: ["object", classId, objectId],
			});
			await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
			await queryClient.invalidateQueries({
				queryKey: ["objects", targetClassId],
			});
			await queryClient.invalidateQueries({
				queryKey: ["collection", updatedObject.collection_id, "permissions"],
			});
			setName(updatedObject.name);
			setDescription(updatedObject.description ?? "");
			setDataInput(stringifyJson(updatedObject.data));
			setCollectionId(String(updatedObject.collection_id));
			setEditingFields([]);
			setFormError(null);
			setFormSuccess("Object updated.");

			if (targetClassId !== classId) {
				router.replace(`/objects/${targetClassId}/${objectId}`);
				router.refresh();
			}
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to update object.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const response = await deleteApiV1ClassesByClassIdByObjectId(
				classId,
				objectId,
				{
					credentials: "include",
				},
			);

			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to delete object."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
			router.push("/objects");
			router.refresh();
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to delete object.",
			);
		},
	});

	const currentUserGroups = currentUserGroupsQuery.data ?? [];
	const permissionEntries = collectionPermissionsQuery.data ?? [];
	const canCheckPermissionMembership = Boolean(currentUsername);
	const permissionCheckPending =
		!canEditAnything &&
		canCheckPermissionMembership &&
		(collectionPermissionsQuery.isLoading || currentUserGroupsQuery.isLoading);
	const canEditObject =
		Boolean(objectQuery.data) &&
		(canEditAnything ||
			(canCheckPermissionMembership &&
				canCurrentUserUpdateObject(permissionEntries, currentUserGroups)));
	const hasActiveEdits = editingFields.length > 0;
	const isSavingOrDeleting =
		updateMutation.isPending || deleteMutation.isPending;
	const beginGlobalEdit = useCallback(() => {
		if (!canEditObject || isSavingOrDeleting) {
			return;
		}

		setFormError(null);
		setFormSuccess(null);
		setEditingFields(ALL_EDITABLE_FIELDS);
	}, [canEditObject, isSavingOrDeleting]);

	useEffect(() => {
		const detail: EditStateEventDetail = {
			label: "Edit object",
			editHandler:
				canEditObject && !hasActiveEdits && !isSavingOrDeleting
					? beginGlobalEdit
					: null,
		};

		window.dispatchEvent(new CustomEvent(EDIT_STATE_EVENT, { detail }));

		return () => {
			window.dispatchEvent(
				new CustomEvent(EDIT_STATE_EVENT, {
					detail: { label: "Edit object", editHandler: null },
				}),
			);
		};
	}, [beginGlobalEdit, canEditObject, hasActiveEdits, isSavingOrDeleting]);

	useEffect(() => {
		const objectData = objectQuery.data;
		if (!objectData) {
			return;
		}

		const currentClass = (classesQuery.data ?? []).find(
			(item) => item.id === objectData.hubuum_class_id,
		);
		const title = currentClass
			? `${currentClass.name} / ${objectData.name}`
			: objectData.name;

		window.dispatchEvent(
			new CustomEvent(TITLE_STATE_EVENT, {
				detail: {
					title,
					pin: {
						type: "object",
						id: objectData.id,
						name: objectData.name,
						collectionId: objectData.collection_id,
						collectionName:
							(collectionsQuery.data ?? []).find(
								(collection) => collection.id === objectData.collection_id,
							)?.name ?? "Collection",
						classId: objectData.hubuum_class_id,
						className: currentClass?.name,
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
	}, [classesQuery.data, collectionsQuery.data, objectQuery.data]);

	function resetFieldDraft(field: EditableField, objectData: HubuumObject) {
		if (field === "name") {
			setName(objectData.name);
			return;
		}

		if (field === "description") {
			setDescription(objectData.description ?? "");
			return;
		}

		if (field === "collection") {
			setCollectionId(String(objectData.collection_id));
			return;
		}

		setDataInput(stringifyJson(objectData.data));
	}

	const cancelActiveEdits = useCallback(() => {
		const objectData = objectQuery.data;
		if (!objectData || editingFields.length === 0) {
			return;
		}

		setName(objectData.name);
		setDescription(objectData.description ?? "");
		setCollectionId(String(objectData.collection_id));
		setDataInput(stringifyJson(objectData.data));
		setEditingFields([]);
		setFormError(null);
		setFormSuccess(null);
	}, [editingFields.length, objectQuery.data]);

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

	function toggleFieldEditing(field: EditableField, objectData: HubuumObject) {
		setFormError(null);
		setFormSuccess(null);

		if (editingFields.includes(field)) {
			resetFieldDraft(field, objectData);
			setEditingFields((current) =>
				current.filter((currentField) => currentField !== field),
			);
			return;
		}

		setEditingFields((current) => [...current, field]);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		if (!canEditObject) {
			setFormError("You do not have permission to update this object.");
			return;
		}

		let parsedData: unknown;
		try {
			parsedData = JSON.parse(dataInput);
		} catch {
			setFormError("Object data must be valid JSON.");
			return;
		}

		const parsedCollectionId = Number.parseInt(collectionId, 10);
		if (!Number.isFinite(parsedCollectionId) || parsedCollectionId < 1) {
			setFormError("Collection ID is required.");
			return;
		}

		const payload: UpdateHubuumObject = {
			name: name.trim(),
			description: description.trim(),
			data: parsedData,
			hubuum_class_id: classId,
			collection_id: parsedCollectionId,
		};

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

		const submitButton = event.currentTarget.querySelector<HTMLButtonElement>(
			"button[type='submit']:not(:disabled)",
		);
		if (!submitButton) {
			return;
		}

		event.preventDefault();
		event.currentTarget.requestSubmit(submitButton);
	}

	async function onDelete() {
		setFormError(null);
		setFormSuccess(null);
		const objectLabel = objectQuery.data?.name ?? "this object";
		const confirmed = await confirm({
			title: `Delete ${objectLabel}?`,
			description: "This removes the object and cannot be undone.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate();
	}

	if (objectQuery.isLoading) {
		return <div className="card">Loading object...</div>;
	}

	if (objectQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load object.{" "}
				{objectQuery.error instanceof Error
					? objectQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const objectData = objectQuery.data;
	if (!objectData) {
		return <div className="card error-banner">Object data is unavailable.</div>;
	}

	const currentClass =
		(classesQuery.data ?? []).find(
			(item) => item.id === objectData.hubuum_class_id,
		) ?? null;
	const hasCollectionOptions = collections.length > 0;
	const hasCollectionSelection = collections.some(
		(collection) => String(collection.id) === collectionId,
	);
	const classNameById = new Map<number, string>();
	for (const item of classesQuery.data ?? []) {
		classNameById.set(item.id, item.name);
	}
	const collectionNameById = new Map<number, string>();
	for (const collection of collections) {
		collectionNameById.set(collection.id, collection.name);
	}
	const objectContextById = new Map<
		number,
		{ classId: number; name: string }
	>();
	objectContextById.set(objectData.id, {
		classId: objectData.hubuum_class_id,
		name: objectData.name,
	});
	for (const relatedObject of relatedObjectsQuery.data ?? []) {
		objectContextById.set(relatedObject.id, {
			classId: relatedObject.hubuum_class_id,
			name: relatedObject.name,
		});
	}
	const relatedObjects = [...(relatedObjectsQuery.data ?? [])].sort(
		(left, right) => {
			const depthDelta = left.path.length - right.path.length;
			if (depthDelta !== 0) {
				return depthDelta;
			}

			return left.name.localeCompare(right.name);
		},
	);
	const ignoredClassSet = new Set(ignoredClassIds);
	const ignoredClassOptions = (classesQuery.data ?? [])
		.filter((item) => item.id !== objectData.hubuum_class_id)
		.sort((left, right) => left.name.localeCompare(right.name));
	const collectionLabel =
		collectionNameById.get(objectData.collection_id) ?? "Collection";
	const editAccessMessage = canEditAnything
		? null
		: permissionCheckPending
			? "Checking whether you can update this object..."
			: canEditObject
				? "Toggle edit only on the fields you want to change."
				: canCheckPermissionMembership
					? "You can view this object, but editing is unavailable because your access does not include UpdateObject on this collection."
					: "Could not identify the current user. Showing a read-only object view.";

	function renderObjectLabel(relatedObjectId: number) {
		const relatedObject = objectContextById.get(relatedObjectId);
		if (!relatedObject) {
			return "Unknown related object";
		}

		const relatedClassName = classNameById.get(relatedObject.classId);
		return relatedClassName
			? `${relatedClassName} / ${relatedObject.name}`
			: relatedObject.name;
	}

	function getDisplayPath(path: number[], targetId: number): number[] {
		const normalizedPath = path.length ? [...path] : [targetId];
		const trimmedPath =
			normalizedPath[0] === objectId ? normalizedPath.slice(1) : normalizedPath;
		if (!trimmedPath.length) {
			return [targetId];
		}

		if (trimmedPath[trimmedPath.length - 1] !== targetId) {
			trimmedPath.push(targetId);
		}

		return trimmedPath;
	}

	function renderPathLink(objectPathId: number) {
		const pathObject = objectContextById.get(objectPathId);
		const label = renderObjectLabel(objectPathId);
		return pathObject ? (
			<Link href={`/objects/${pathObject.classId}/${objectPathId}`}>
				{label}
			</Link>
		) : (
			<span>{label}</span>
		);
	}

	function renderObjectPath(path: number[], keyPrefix: string) {
		return (
			<>
				{path.map((pathObjectId, index) => (
					<span key={`${keyPrefix}-${path.slice(0, index + 1).join("-")}`}>
						{index > 0 ? " \u2192 " : null}
						{renderPathLink(pathObjectId)}
					</span>
				))}
			</>
		);
	}

	const relatedObjectGroups = (() => {
		const groups = new Map<
			number,
			{ rootPath: number[]; children: number[][] }
		>();
		for (const relatedObject of relatedObjects) {
			const displayPath = getDisplayPath(relatedObject.path, relatedObject.id);
			const rootId = displayPath[0];
			if (!rootId) {
				continue;
			}

			const existingGroup = groups.get(rootId);
			if (!existingGroup) {
				groups.set(rootId, {
					rootPath: [rootId],
					children: displayPath.length > 1 ? [displayPath.slice(1)] : [],
				});
				continue;
			}

			if (displayPath.length > 1) {
				existingGroup.children.push(displayPath.slice(1));
			}
		}

		return [...groups.entries()]
			.map(([rootId, group]) => ({
				rootId,
				rootLabel: renderObjectLabel(rootId),
				rootPath: group.rootPath,
				children: [...group.children].sort((left, right) => {
					const leftFirstHop = left[0];
					const rightFirstHop = right[0];
					const leftClassName =
						leftFirstHop === undefined
							? ""
							: (classNameById.get(
									objectContextById.get(leftFirstHop)?.classId ?? -1,
								) ?? "");
					const rightClassName =
						rightFirstHop === undefined
							? ""
							: (classNameById.get(
									objectContextById.get(rightFirstHop)?.classId ?? -1,
								) ?? "");
					const classCompare = leftClassName.localeCompare(rightClassName);
					if (classCompare !== 0) {
						return classCompare;
					}

					const leftLabel = left
						.map((objectPathId) => renderObjectLabel(objectPathId))
						.join(" / ");
					const rightLabel = right
						.map((objectPathId) => renderObjectLabel(objectPathId))
						.join(" / ");
					return leftLabel.localeCompare(rightLabel);
				}),
			}))
			.sort((left, right) => left.rootLabel.localeCompare(right.rootLabel));
	})();

	function toggleIgnoredClass(classToToggle: number, checked: boolean) {
		setIgnoredClassIds((current) => {
			if (checked) {
				return current.includes(classToToggle)
					? current
					: [...current, classToToggle].sort((left, right) => left - right);
			}

			return current.filter((classIdValue) => classIdValue !== classToToggle);
		});
	}

	return (
		<section className="stack">
			<ObjectDetailTracker
				objectId={objectId}
				objectName={objectData.name}
				classId={classId}
				collectionId={objectData.collection_id}
			/>
			<form
				className="card stack"
				onSubmit={onSubmit}
				onKeyDownCapture={onSubmitShortcut}
			>
				<div className="object-meta-strip">
					<div className="object-meta-item">
						<span className="object-meta-label">Created</span>
						<span className="object-meta-value">
							{formatTimestamp(objectData.created_at)}
						</span>
					</div>
					<div className="object-meta-item">
						<span className="object-meta-label">Updated</span>
						<span className="object-meta-value">
							{formatTimestamp(objectData.updated_at)}
						</span>
					</div>
				</div>

				{editAccessMessage ? (
					<div className="muted">{editAccessMessage}</div>
				) : null}

				<div className="object-detail-list">
					<div className="object-detail-compact-grid">
						<section
							className={`object-detail-row object-detail-row--compact${editingFields.includes("name") ? " is-editing" : ""}`}
						>
							<div className="object-detail-label">Name</div>
							<div className="object-detail-body">
								{editingFields.includes("name") ? (
									<label className="control-field">
										<span className="sr-only">Object name</span>
										<input
											required
											value={name}
											onChange={(event) => setName(event.target.value)}
										/>
									</label>
								) : canEditObject ? (
									<button
										type="button"
										className="object-inline-edit"
										onClick={() => toggleFieldEditing("name", objectData)}
										disabled={isSavingOrDeleting}
									>
										<span className="object-detail-value">
											{renderFieldText(objectData.name)}
										</span>
										<span className="object-inline-edit-icon">
											<InlineEditIcon />
										</span>
									</button>
								) : (
									<div className="object-detail-value">
										{renderFieldText(objectData.name)}
									</div>
								)}
							</div>
						</section>

						<section
							className={`object-detail-row object-detail-row--compact${editingFields.includes("description") ? " is-editing" : ""}`}
						>
							<div className="object-detail-label">Description</div>
							<div className="object-detail-body">
								{editingFields.includes("description") ? (
									<label className="control-field">
										<span className="sr-only">Object description</span>
										<input
											required
											value={description}
											onChange={(event) => setDescription(event.target.value)}
										/>
									</label>
								) : canEditObject ? (
									<button
										type="button"
										className="object-inline-edit"
										onClick={() =>
											toggleFieldEditing("description", objectData)
										}
										disabled={isSavingOrDeleting}
									>
										<span className="object-detail-value">
											{renderFieldText(objectData.description ?? "")}
										</span>
										<span className="object-inline-edit-icon">
											<InlineEditIcon />
										</span>
									</button>
								) : (
									<div className="object-detail-value">
										{renderFieldText(objectData.description ?? "")}
									</div>
								)}
							</div>
						</section>

						<section
							className={`object-detail-row object-detail-row--compact${editingFields.includes("collection") ? " is-editing" : ""}`}
						>
							<div className="object-detail-label">Collection</div>
							<div className="object-detail-body">
								{editingFields.includes("collection") ? (
									<div className="control-field">
										<label
											htmlFor="object-detail-collection"
											className="sr-only"
										>
											Collection
										</label>
										{hasCollectionOptions ? (
											<select
												id="object-detail-collection"
												required
												value={hasCollectionSelection ? collectionId : ""}
												onChange={(event) =>
													setCollectionId(event.target.value)
												}
											>
												{!hasCollectionSelection ? (
													<option value="">Select a collection...</option>
												) : null}
												{collections.map((collection) => (
													<option key={collection.id} value={collection.id}>
														{collection.name}
													</option>
												))}
											</select>
										) : (
											<input
												id="object-detail-collection"
												required
												type="number"
												min={1}
												value={collectionId}
												onChange={(event) =>
													setCollectionId(event.target.value)
												}
												placeholder={
													collectionsQuery.isLoading
														? "Loading collections..."
														: "Enter collection ID"
												}
												disabled={collectionsQuery.isLoading}
											/>
										)}
									</div>
								) : canEditObject ? (
									<button
										type="button"
										className="object-inline-edit"
										onClick={() => toggleFieldEditing("collection", objectData)}
										disabled={isSavingOrDeleting}
									>
										<span className="object-detail-value">
											{collectionLabel}
										</span>
										<span className="object-inline-edit-icon">
											<InlineEditIcon />
										</span>
									</button>
								) : (
									<div className="object-detail-value">{collectionLabel}</div>
								)}
							</div>
						</section>
					</div>

					<section
						className={`object-detail-row object-detail-row--data${editingFields.includes("data") ? " is-editing" : ""}`}
					>
						<div className="object-detail-label">Data</div>
						<div className="object-detail-body">
							{editingFields.includes("data") ? (
								<JsonEditor
									id="object-detail-data"
									label="Data (JSON)"
									value={dataInput}
									onChange={setDataInput}
									placeholder='{"hostname":"srv-web-01","env":"prod"}'
									mode="data"
									rows={10}
									validationEnabled={currentClass?.validate_schema ?? false}
									validationSchema={currentClass?.json_schema}
									helperText={
										currentClass?.validate_schema
											? "This class validates object data against its JSON schema."
											: "This class does not currently enforce JSON schema validation."
									}
								/>
							) : (
								<JsonViewer value={objectData.data} />
							)}
						</div>
						<div className="object-detail-row-actions">
							{canEditObject && !editingFields.includes("data") ? (
								<button
									type="button"
									className="ghost"
									onClick={() => toggleFieldEditing("data", objectData)}
									disabled={isSavingOrDeleting}
								>
									Edit
								</button>
							) : null}
						</div>
					</section>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{classesQuery.isError ? (
					<div className="muted">
						Could not load class names. Showing class ID only.
					</div>
				) : null}
				{collectionsQuery.isError ? (
					<div className="muted">
						Could not load collections automatically. Manual collection ID entry
						is enabled.
					</div>
				) : null}
				{collectionPermissionsQuery.isError ? (
					<div className="muted">
						Could not verify collection update permissions. Editing is hidden
						until that check succeeds.
					</div>
				) : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions form-actions--spread">
					{canEditObject ? (
						hasActiveEdits ? (
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
							<div className="muted">
								Toggle edit on for a field to make changes.
							</div>
						)
					) : (
						<div className="muted">This object is currently read-only.</div>
					)}
					{hasActiveEdits ? null : (
						<button
							type="button"
							className="danger"
							onClick={onDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete object"}
						</button>
					)}
				</div>
			</form>

			<RemoteInvocationsPanel
				collectionId={objectData.collection_id}
				subject={{ type: "object", class_id: classId, object_id: objectId }}
				subjectLabel={`object "${objectData.name}"`}
				subjectType="object"
				targetClassId={classId}
			/>

			<ResourceActivityPanel
				scope={{ type: "object", classId, objectId }}
				title="Object audit and history"
			/>

			<section className="card stack">
				{relatedObjectsQuery.isLoading ? (
					<div className="muted">Loading object relations...</div>
				) : null}
				{relatedObjectsQuery.isError ? (
					<div className="error-banner">
						Failed to load object relations.{" "}
						{relatedObjectsQuery.error instanceof Error
							? relatedObjectsQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!relatedObjectsQuery.isLoading && !relatedObjectsQuery.isError ? (
					<>
						<div className="relations-toolbar">
							<div className="relations-toolbar-meta">
								<h3 className="relations-title">
									Relations: {relatedObjects.length}
								</h3>
								<div className="relations-depth-control">
									<span>Depth:</span>
									<div className="relations-stepper">
										<input
											type="number"
											min={1}
											step={1}
											value={relationDepthLimit}
											onChange={(event) => {
												const parsed = Number.parseInt(event.target.value, 10);
												setRelationDepthLimit(
													Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
												);
											}}
											aria-label="Relationship depth"
										/>
									</div>
								</div>
								<label className="relations-toggle">
									<input
										type="checkbox"
										checked={includeSelfClass}
										onChange={(event) =>
											setIncludeSelfClass(event.target.checked)
										}
									/>
									<span>Include self class</span>
								</label>
								<div
									className="relations-filter-dropdown"
									ref={ignoreClassesRef}
								>
									<button
										type="button"
										className="ghost relations-filter-trigger"
										onClick={() => setIgnoreClassesOpen((current) => !current)}
										aria-haspopup="menu"
										aria-expanded={isIgnoreClassesOpen}
									>
										Ignore classes
										{ignoredClassIds.length
											? ` (${ignoredClassIds.length})`
											: ""}
									</button>
									{isIgnoreClassesOpen ? (
										<div className="relations-filter-menu" role="menu">
											{ignoredClassOptions.length ? (
												ignoredClassOptions.map((hubuumClass) => (
													<label
														key={hubuumClass.id}
														className="relations-filter-option"
													>
														<input
															type="checkbox"
															checked={ignoredClassSet.has(hubuumClass.id)}
															onChange={(event) =>
																toggleIgnoredClass(
																	hubuumClass.id,
																	event.target.checked,
																)
															}
														/>
														<span>{hubuumClass.name}</span>
													</label>
												))
											) : (
												<div className="muted">No other classes available.</div>
											)}
										</div>
									) : null}
								</div>
							</div>
							<Link
								className="link-chip"
								href={`/relations/objects?classId=${objectData.hubuum_class_id}&objectId=${objectId}&objectView=reachable`}
							>
								Open relations
							</Link>
						</div>

						{relatedObjects.length === 0 ? (
							<EmptyState
								title="No reachable objects yet."
								description="Create object relations to connect this object with related objects."
								action={
									<Link
										className="link-chip"
										href={`/relations/objects?classId=${objectData.hubuum_class_id}&objectId=${objectId}&objectView=direct`}
									>
										Open relations
									</Link>
								}
							/>
						) : (
							<ul className="stat-list compact-stat-list relations-path-list">
								{relatedObjectGroups.map((group) => (
									<li key={group.rootId}>
										<div>
											{renderObjectPath(group.rootPath, `root-${group.rootId}`)}
										</div>
										{group.children.map((childPath) => (
											<div
												key={`child-${group.rootId}-${childPath.join("-")}`}
												className="relations-child-path"
											>
												<span className="muted">{"\u2192 "}</span>
												{renderObjectPath(childPath, `child-${group.rootId}`)}
											</div>
										))}
									</li>
								))}
							</ul>
						)}
						{relatedObjectsQuery.isError ? (
							<div className="muted">
								Could not resolve all related objects automatically. Showing IDs
								instead.
							</div>
						) : null}
						{classesQuery.isError ? (
							<div className="muted">
								Could not load class names. Showing class IDs instead.
							</div>
						) : null}
					</>
				) : null}
			</section>
		</section>
	);
}
