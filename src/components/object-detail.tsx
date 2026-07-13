"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
import { TITLE_STATE_EVENT } from "@/lib/create-events";
import {
	buildRelatedObjectSearchParams,
	DEFAULT_INCLUDE_SELF_CLASS,
	normalizeRelatedObjectPath,
	summarizeRelatedObjectData,
} from "@/lib/object-relation-summary";
import { flattenObjectPropertyEntries } from "@/lib/object-property-entries";

type ObjectDetailProps = {
	classId: number;
	objectId: number;
	currentUsername: string | null;
	canEditAnything: boolean;
};

type EditableField = "name" | "description" | "collection" | "data";

const ALL_EDITABLE_FIELDS: EditableField[] = [
	"data",
	"collection",
	"description",
	"name",
];

const CONNECTION_PROPERTY_LIMIT = 12;

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
	const response = await getApiV1Classes(
		{ include_total: false },
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
		const response = await getApiV1IamMeGroups(
			{ include_total: false },
			{
				credentials: "include",
			},
		);
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
	const params = buildRelatedObjectSearchParams({
		depthLimit,
		includeSelfClass,
		ignoredClassIds,
	});
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

function ObjectPropertyItem({
	label,
	className = "",
	children,
}: {
	label: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={`object-property-item${className ? ` ${className}` : ""}`}>
			<dt title={typeof label === "string" ? label : undefined}>{label}</dt>
			<dd>{children}</dd>
		</div>
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
	const objectFormRef = useRef<HTMLFormElement | null>(null);
	const ignoreClassesRef = useRef<HTMLDivElement | null>(null);
	const editAllButtonRef = useRef<HTMLButtonElement | null>(null);
	const nameInputRef = useRef<HTMLInputElement | null>(null);
	const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null);
	const collectionSelectRef = useRef<HTMLSelectElement | null>(null);
	const collectionInputRef = useRef<HTMLInputElement | null>(null);

	const [relationDepthLimit, setRelationDepthLimit] = useState(2);
	const [showAllRelations, setShowAllRelations] = useState(false);
	const [includeSelfClass, setIncludeSelfClass] = useState(
		DEFAULT_INCLUDE_SELF_CLASS,
	);
	const [ignoredClassIds, setIgnoredClassIds] = useState<number[]>([]);
	const [isIgnoreClassesOpen, setIgnoreClassesOpen] = useState(false);
	const [isConnectionToolsOpen, setConnectionToolsOpen] = useState(false);
	const [isDataInspectorOpen, setDataInspectorOpen] = useState(false);
	const [dataFieldFilter, setDataFieldFilter] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [dataInput, setDataInput] = useState("{}");
	const [collectionId, setCollectionId] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [editingFields, setEditingFields] = useState<EditableField[]>([]);
	const [dirtyFields, setDirtyFields] = useState<EditableField[]>([]);
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
	const flattenedObjectData = useMemo(
		() => flattenObjectPropertyEntries(objectQuery.data?.data),
		[objectQuery.data?.data],
	);

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

	useEffect(() => {
		const lastEditingField = editingFields.at(-1);
		if (lastEditingField === "name") {
			nameInputRef.current?.focus();
		} else if (lastEditingField === "description") {
			descriptionInputRef.current?.focus();
		} else if (lastEditingField === "collection") {
			(collectionSelectRef.current ?? collectionInputRef.current)?.focus();
		}
	}, [editingFields]);

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
			setDirtyFields([]);
			setFormError(null);
			setFormSuccess("Object updated.");
			window.requestAnimationFrame(() => editAllButtonRef.current?.focus());

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
		setDirtyFields([]);
	}, [canEditObject, isSavingOrDeleting]);

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
		setDirtyFields([]);
		setFormError(null);
		setFormSuccess(null);
		window.requestAnimationFrame(() => editAllButtonRef.current?.focus());
	}, [editingFields.length, objectQuery.data]);

	useEffect(() => {
		if (!hasActiveEdits) {
			return;
		}

		function onEscape(event: KeyboardEvent) {
			if (event.key !== "Escape") {
				return;
			}
			if (
				!(event.target instanceof Node) ||
				!objectFormRef.current?.contains(event.target)
			) {
				return;
			}
			if (
				event.defaultPrevented ||
				(event.target instanceof Element &&
					event.target.closest(
						".json-editor, .relations-filter-dropdown, [role='dialog']",
					))
			) {
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
			setDirtyFields((current) =>
				current.filter((currentField) => currentField !== field),
			);
			return;
		}

		setEditingFields((current) => [...current, field]);
	}

	function markFieldDirty(field: EditableField) {
		setDirtyFields((current) =>
			current.includes(field) ? current : [...current, field],
		);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);
		if (editingFields.length === 0) {
			return;
		}

		if (!canEditObject) {
			setFormError("You do not have permission to update this object.");
			return;
		}
		const currentObject = objectQuery.data;
		if (!currentObject) {
			setFormError("Object data is unavailable.");
			return;
		}

		const payload: UpdateHubuumObject = {};
		if (dirtyFields.includes("name")) {
			const nextName = name.trim();
			if (!nextName) {
				setFormError("Object name is required.");
				return;
			}
			if (name !== currentObject.name && nextName !== currentObject.name) {
				payload.name = nextName;
			}
		}

		if (dirtyFields.includes("description")) {
			const nextDescription = description.trim();
			if (
				description !== (currentObject.description ?? "") &&
				nextDescription !== (currentObject.description ?? "")
			) {
				payload.description = nextDescription;
			}
		}

		if (dirtyFields.includes("data")) {
			try {
				const parsedData = JSON.parse(dataInput);
				if (stringifyJson(parsedData) !== stringifyJson(currentObject.data)) {
					payload.data = parsedData;
				}
			} catch {
				setFormError("Object data must be valid JSON.");
				return;
			}
		}

		if (dirtyFields.includes("collection")) {
			const parsedCollectionId = Number.parseInt(collectionId, 10);
			if (!Number.isFinite(parsedCollectionId) || parsedCollectionId < 1) {
				setFormError("Collection ID is required.");
				return;
			}
			if (parsedCollectionId !== currentObject.collection_id) {
				payload.collection_id = parsedCollectionId;
			}
		}

		if (Object.keys(payload).length === 0) {
			setEditingFields([]);
			setDirtyFields([]);
			setFormSuccess("No changes to save.");
			window.requestAnimationFrame(() => editAllButtonRef.current?.focus());
			return;
		}

		updateMutation.mutate(payload);
	}

	function onSubmitShortcut(event: ReactKeyboardEvent<HTMLFormElement>) {
		const target = event.target;
		if (
			event.key === "Enter" &&
			!event.ctrlKey &&
			!event.metaKey &&
			target instanceof HTMLInputElement &&
			!["button", "checkbox", "radio", "reset", "submit"].includes(
				target.type,
			) &&
			target.closest("[data-object-nonsubmit]")
		) {
			event.preventDefault();
			return;
		}

		if (
			event.key !== "Enter" ||
			(!event.ctrlKey && !event.metaKey) ||
			event.altKey ||
			event.shiftKey
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
				? null
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
		return normalizeRelatedObjectPath(objectId, targetId, path);
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
	const flattenedData = flattenedObjectData;
	const normalizedDataFilter = dataFieldFilter.trim().toLocaleLowerCase();
	const visibleDataProperties = normalizedDataFilter
		? flattenedData.entries.filter(
				(entry) =>
					entry.label.toLocaleLowerCase().includes(normalizedDataFilter) ||
					entry.value.toLocaleLowerCase().includes(normalizedDataFilter),
			)
		: flattenedData.entries;
	const directRelatedObjects = relatedObjects.filter(
		(relatedObject) =>
			getDisplayPath(relatedObject.path, relatedObject.id).length === 1,
	);
	const directRelationCount = directRelatedObjects.length;
	const indirectRelationCount = Math.max(
		0,
		relatedObjects.length - directRelationCount,
	);
	const visibleConnections = showAllRelations
		? relatedObjects
		: relatedObjects.slice(0, CONNECTION_PROPERTY_LIMIT);
	const hiddenConnectionCount =
		relatedObjects.length - visibleConnections.length;

	function toggleIgnoredClass(classToToggle: number, checked: boolean) {
		setShowAllRelations(false);
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
				ref={objectFormRef}
				className="card stack resource-index object-properties-card"
				onSubmit={onSubmit}
				onKeyDownCapture={onSubmitShortcut}
			>
				<header className="object-record-toolbar">
					<h2 className="sr-only">Object properties</h2>
					<div className="object-record-heading">
						<span className="eyebrow">
							{currentClass?.name ?? `Class #${objectData.hubuum_class_id}`}
						</span>
						<strong>Object #{objectData.id}</strong>
						<span className="muted">
							{flattenedData.entries.length}
							{flattenedData.truncated ? "+" : ""} data field
							{flattenedData.entries.length === 1 ? "" : "s"} ·{" "}
							{relatedObjects.length} connection
							{relatedObjects.length === 1 ? "" : "s"} loaded
						</span>
					</div>
					<div className="object-record-actions">
						<div className="object-record-times">
							<span>
								Created{" "}
								<time dateTime={objectData.created_at}>
									{formatTimestamp(objectData.created_at)}
								</time>
							</span>
							<span>
								Updated{" "}
								<time dateTime={objectData.updated_at}>
									{formatTimestamp(objectData.updated_at)}
								</time>
							</span>
						</div>
						{canEditObject && !hasActiveEdits ? (
							<button
								ref={editAllButtonRef}
								type="button"
								onClick={beginGlobalEdit}
								disabled={isSavingOrDeleting}
							>
								Edit all
							</button>
						) : null}
					</div>
				</header>

				{editAccessMessage ? (
					<div className="muted object-edit-access-note">
						{editAccessMessage}
					</div>
				) : null}

				<div className="object-property-surface">
					<section
						className="object-property-section object-property-section--identity"
						aria-labelledby="object-identity-heading"
					>
						<h3 id="object-identity-heading" className="sr-only">
							Object identity
						</h3>
						<div className="object-fact-grid object-fact-grid--core">
							<div
								className={`object-fact${editingFields.includes("name") ? " is-editing" : ""}`}
							>
								<div className="object-fact-label">Name</div>
								<div className="object-fact-value">
									{editingFields.includes("name") ? (
										<label className="control-field">
											<span className="sr-only">Object name</span>
											<input
												ref={nameInputRef}
												required
												value={name}
												onChange={(event) => {
													setName(event.target.value);
													markFieldDirty("name");
												}}
											/>
										</label>
									) : canEditObject ? (
										<button
											type="button"
											className="object-inline-edit"
											onClick={() => toggleFieldEditing("name", objectData)}
											disabled={isSavingOrDeleting}
											aria-label={`Edit object name. Current value: ${renderFieldText(objectData.name)}`}
											title={`Edit object name: ${renderFieldText(objectData.name)}`}
										>
											<span className="object-fact-display-value">
												{renderFieldText(objectData.name)}
											</span>
											<span
												className="object-inline-edit-icon"
												aria-hidden="true"
											>
												<InlineEditIcon />
											</span>
										</button>
									) : (
										<div
											className="object-fact-display-value"
											title={renderFieldText(objectData.name)}
										>
											{renderFieldText(objectData.name)}
										</div>
									)}
								</div>
							</div>

							<div
								className={`object-fact object-fact--wide${editingFields.includes("description") ? " is-editing" : ""}`}
							>
								<div className="object-fact-label">Description</div>
								<div className="object-fact-value">
									{editingFields.includes("description") ? (
										<label className="control-field">
											<span className="sr-only">Object description</span>
											<textarea
												ref={descriptionInputRef}
												rows={2}
												value={description}
												onChange={(event) => {
													setDescription(event.target.value);
													markFieldDirty("description");
												}}
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
											aria-label={`Edit object description. Current value: ${renderFieldText(objectData.description ?? "")}`}
											title={`Edit object description: ${renderFieldText(objectData.description ?? "")}`}
										>
											<span className="object-fact-display-value">
												{renderFieldText(objectData.description ?? "")}
											</span>
											<span
												className="object-inline-edit-icon"
												aria-hidden="true"
											>
												<InlineEditIcon />
											</span>
										</button>
									) : (
										<div
											className="object-fact-display-value"
											title={renderFieldText(objectData.description ?? "")}
										>
											{renderFieldText(objectData.description ?? "")}
										</div>
									)}
								</div>
							</div>

							<div
								className={`object-fact${editingFields.includes("collection") ? " is-editing" : ""}`}
							>
								<div className="object-fact-label">Collection</div>
								<div className="object-fact-value">
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
													ref={collectionSelectRef}
													id="object-detail-collection"
													required
													value={hasCollectionSelection ? collectionId : ""}
													onChange={(event) => {
														setCollectionId(event.target.value);
														markFieldDirty("collection");
													}}
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
													ref={collectionInputRef}
													id="object-detail-collection"
													required
													type="number"
													min={1}
													value={collectionId}
													onChange={(event) => {
														setCollectionId(event.target.value);
														markFieldDirty("collection");
													}}
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
											onClick={() =>
												toggleFieldEditing("collection", objectData)
											}
											disabled={isSavingOrDeleting}
											aria-label={`Edit object collection. Current value: ${collectionLabel}`}
											title={`Edit object collection: ${collectionLabel}`}
										>
											<span className="object-fact-display-value">
												{collectionLabel}
											</span>
											<span
												className="object-inline-edit-icon"
												aria-hidden="true"
											>
												<InlineEditIcon />
											</span>
										</button>
									) : (
										<div
											className="object-fact-display-value"
											title={collectionLabel}
										>
											{collectionLabel}
										</div>
									)}
								</div>
							</div>

							<div className="object-fact">
								<div className="object-fact-label">Class</div>
								<div
									className="object-fact-value"
									title={
										currentClass?.name ?? `Class #${objectData.hubuum_class_id}`
									}
								>
									{currentClass?.name ?? `Class #${objectData.hubuum_class_id}`}
								</div>
							</div>
						</div>
					</section>

					<section
						className={`object-property-section object-property-section--data${editingFields.includes("data") ? " is-editing" : ""}`}
						aria-labelledby="object-data-heading"
					>
						<header className="object-property-section-header">
							<div>
								<span className="eyebrow">Primary data</span>
								<div className="table-title-row">
									<h3 id="object-data-heading">Data fields</h3>
									<span className="muted table-count">
										{normalizedDataFilter
											? `${visibleDataProperties.length} of ${flattenedData.entries.length}`
											: flattenedData.truncated
												? `${flattenedData.entries.length}+`
												: flattenedData.entries.length}
									</span>
								</div>
							</div>
							<div className="object-property-section-actions">
								<label className="object-data-filter" data-object-nonsubmit>
									<span className="sr-only">Filter object data fields</span>
									<input
										type="search"
										value={dataFieldFilter}
										onChange={(event) => setDataFieldFilter(event.target.value)}
										placeholder="Filter data fields"
										disabled={editingFields.includes("data")}
									/>
								</label>
								{canEditObject ? (
									<button
										type="button"
										className="ghost"
										onClick={() => toggleFieldEditing("data", objectData)}
										disabled={isSavingOrDeleting}
									>
										{editingFields.includes("data")
											? "Cancel data edit"
											: "Edit data"}
									</button>
								) : null}
							</div>
						</header>

						{editingFields.includes("data") ? (
							<div className="object-property-panel object-data-editor-panel">
								<JsonEditor
									id="object-detail-data"
									label="Data (JSON)"
									value={dataInput}
									onChange={(value) => {
										setDataInput(value);
										markFieldDirty("data");
									}}
									placeholder='{"hostname":"srv-web-01","env":"prod"}'
									mode="data"
									rows={16}
									validationEnabled={currentClass?.validate_schema ?? false}
									validationSchema={currentClass?.json_schema}
									helperText={
										currentClass?.validate_schema
											? "This class validates object data against its JSON schema."
											: "This class does not currently enforce JSON schema validation."
									}
								/>
							</div>
						) : (
							<>
								{visibleDataProperties.length ? (
									<dl className="object-property-grid object-property-grid--data">
										{visibleDataProperties.map((entry) => (
											<ObjectPropertyItem
												key={`data:${entry.id}`}
												label={entry.label}
												className={`object-property-item--data object-property-item--${entry.kind}`}
											>
												<span title={entry.value}>{entry.value}</span>
											</ObjectPropertyItem>
										))}
									</dl>
								) : (
									<div className="object-property-empty">
										No data fields match “{dataFieldFilter}”.
									</div>
								)}
								{flattenedData.truncated ? (
									<div className="object-property-note">
										Showing the first {flattenedData.entries.length} flattened
										fields. Use the structured inspector for the complete value.
									</div>
								) : null}
								<details
									className="object-property-inspector"
									data-object-nonsubmit
									open={isDataInspectorOpen}
									onToggle={(event) =>
										setDataInspectorOpen(event.currentTarget.open)
									}
								>
									<summary>
										<span>Inspect structured data</span>
										<span>Overview · Tree · JSON</span>
									</summary>
									{isDataInspectorOpen ? (
										<div className="object-property-inspector-panel">
											<JsonViewer value={objectData.data} defaultTab="tree" />
										</div>
									) : null}
								</details>
							</>
						)}
					</section>

					<section
						id="object-connections"
						className="object-property-section object-property-section--connections"
						aria-labelledby="object-connections-heading"
					>
						<header className="object-property-section-header">
							<div>
								<span className="eyebrow">Related properties</span>
								<div className="table-title-row">
									<h3 id="object-connections-heading">Connections</h3>
									<span className="muted table-count">
										{directRelationCount} direct · {indirectRelationCount}{" "}
										indirect
									</span>
								</div>
							</div>
							<Link
								className="link-chip"
								href={`/relations/objects?classId=${objectData.hubuum_class_id}&objectId=${objectId}&objectView=direct`}
							>
								Manage relations
							</Link>
						</header>

						{relatedObjectsQuery.isLoading ? (
							<div className="object-property-empty" role="status">
								Loading connected objects...
							</div>
						) : null}
						{relatedObjectsQuery.isError ? (
							<div className="object-property-empty error-banner" role="alert">
								Failed to load connected objects.{" "}
								{relatedObjectsQuery.error instanceof Error
									? relatedObjectsQuery.error.message
									: "Unknown error"}
							</div>
						) : null}
						{!relatedObjectsQuery.isLoading && !relatedObjectsQuery.isError ? (
							relatedObjects.length ? (
								<>
									<dl className="object-property-grid object-property-grid--connections">
										{visibleConnections.map((relatedObject) => {
											const displayPath = getDisplayPath(
												relatedObject.path,
												relatedObject.id,
											);
											const dataSummary = summarizeRelatedObjectData(
												relatedObject.data,
												2,
											);
											const relatedClassLabel =
												classNameById.get(relatedObject.hubuum_class_id) ??
												`Class #${relatedObject.hubuum_class_id}`;
											return (
												<ObjectPropertyItem
													key={`connection:${relatedObject.hubuum_class_id}:${relatedObject.id}:${displayPath.join("-")}`}
													className="object-property-item--connection"
													label={
														<span className="object-connection-key">
															<span>{relatedClassLabel}</span>
															<span
																className={`relation-depth-badge relation-depth-badge--${displayPath.length === 1 ? "direct" : "indirect"}`}
															>
																{displayPath.length === 1
																	? "Direct"
																	: `${displayPath.length} hops`}
															</span>
														</span>
													}
												>
													<div className="object-connection-value">
														<Link
															className="row-link"
															href={`/objects/${relatedObject.hubuum_class_id}/${relatedObject.id}`}
														>
															{relatedObject.name}
														</Link>
														{relatedObject.description ? (
															<span
																className="object-connection-description"
																title={relatedObject.description}
															>
																{relatedObject.description}
															</span>
														) : null}
														{dataSummary.length ? (
															<span className="object-connection-preview">
																{dataSummary.map((entry) => (
																	<span key={entry.label}>
																		<strong>{entry.label}</strong> {entry.value}
																	</span>
																))}
															</span>
														) : null}
														{displayPath.length > 1 ? (
															<span className="object-connection-route">
																via{" "}
																{renderObjectPath(
																	displayPath.slice(0, -1),
																	`property-${relatedObject.id}`,
																)}
															</span>
														) : null}
													</div>
												</ObjectPropertyItem>
											);
										})}
									</dl>
									{hiddenConnectionCount > 0 ? (
										<button
											type="button"
											className="ghost object-property-more"
											onClick={() => setShowAllRelations(true)}
										>
											Show {hiddenConnectionCount} more connection
											{hiddenConnectionCount === 1 ? "" : "s"}
										</button>
									) : showAllRelations &&
										relatedObjects.length > CONNECTION_PROPERTY_LIMIT ? (
										<button
											type="button"
											className="ghost object-property-more"
											onClick={() => setShowAllRelations(false)}
										>
											Show fewer
										</button>
									) : null}
								</>
							) : (
								<div className="object-property-empty">
									No connections match the current filters. Same-class objects
									are hidden by default.
								</div>
							)
						) : null}
						<details
							className="object-property-inspector object-connection-tools"
							data-object-nonsubmit
							open={isConnectionToolsOpen}
							onToggle={(event) =>
								setConnectionToolsOpen(event.currentTarget.open)
							}
						>
							<summary>
								<span>Connection paths and filters</span>
								<span>
									Depth {relationDepthLimit} ·{" "}
									{includeSelfClass
										? "same class included"
										: "same class hidden"}
								</span>
							</summary>
							{isConnectionToolsOpen ? (
								<div className="object-property-inspector-panel">
									<div className="relations-control-bar">
										<label className="relations-depth-control">
											<span>Depth</span>
											<input
												className="relations-depth-input"
												type="number"
												min={1}
												step={1}
												value={relationDepthLimit}
												onChange={(event) => {
													const nextDepth = Number.parseInt(
														event.target.value,
														10,
													);
													if (Number.isFinite(nextDepth) && nextDepth > 0) {
														setShowAllRelations(false);
														setRelationDepthLimit(nextDepth);
													}
												}}
												aria-label="Connection depth"
											/>
										</label>
										<label className="relations-toggle">
											<input
												type="checkbox"
												checked={includeSelfClass}
												onChange={(event) => {
													setShowAllRelations(false);
													setIncludeSelfClass(event.target.checked);
												}}
											/>
											<span>
												Include {currentClass?.name ?? "current class"}
											</span>
										</label>
										<div
											className="relations-filter-dropdown"
											ref={ignoreClassesRef}
										>
											<button
												type="button"
												className="ghost relations-filter-trigger"
												onClick={() =>
													setIgnoreClassesOpen((current) => !current)
												}
												aria-expanded={isIgnoreClassesOpen}
												aria-controls="object-relation-class-filters"
											>
												Class filters
												{ignoredClassIds.length
													? ` (${ignoredClassIds.length})`
													: ""}
											</button>
											{isIgnoreClassesOpen ? (
												<div
													id="object-relation-class-filters"
													className="relations-filter-menu"
												>
													<strong>Hide classes</strong>
													<span className="muted">
														Exclude noisy classes from this view.
													</span>
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
														<div className="muted">
															No other classes available.
														</div>
													)}
												</div>
											) : null}
										</div>
									</div>
									{relatedObjectGroups.length ? (
										<ul className="stat-list compact-stat-list relations-path-list">
											{relatedObjectGroups.map((group) => (
												<li key={group.rootId}>
													<div>
														{renderObjectPath(
															group.rootPath,
															`root-${group.rootId}`,
														)}
													</div>
													{group.children.map((childPath) => (
														<div
															key={`child-${group.rootId}-${childPath.join("-")}`}
															className="relations-child-path"
														>
															<span className="muted">{"\u2192 "}</span>
															{renderObjectPath(
																childPath,
																`child-${group.rootId}`,
															)}
														</div>
													))}
												</li>
											))}
										</ul>
									) : (
										<div className="muted">
											No connection paths in this view.
										</div>
									)}
								</div>
							) : null}
						</details>
					</section>
				</div>

				{hasActiveEdits ? (
					<fieldset className="object-edit-dock">
						<legend className="sr-only">Unsaved object changes</legend>
						<div className="object-edit-dock-copy">
							<strong>
								Editing {editingFields.length} field
								{editingFields.length === 1 ? "" : "s"}
							</strong>
							<span>Ctrl/Cmd + Enter to save · Esc to cancel</span>
						</div>
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
					</fieldset>
				) : null}

				{formError ? (
					<div className="error-banner" role="alert">
						{formError}
					</div>
				) : null}
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
				{formSuccess ? (
					<div className="muted" role="status">
						{formSuccess}
					</div>
				) : null}

				{!hasActiveEdits ? (
					<div className="object-detail-footer">
						{canEditObject ? null : (
							<div className="muted">This object is currently read-only.</div>
						)}
						<button
							type="button"
							className="danger"
							onClick={onDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete object"}
						</button>
					</div>
				) : null}
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
		</section>
	);
}
