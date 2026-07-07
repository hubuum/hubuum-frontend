"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
	FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useState,
} from "react";
import { EmptyState } from "@/components/empty-state";
import { CollectionEventSubscriptionsPanel } from "@/components/collection-event-subscriptions-panel";
import { CollectionDetailTracker } from "@/components/collection-detail-tracker";
import { RemoteInvocationsPanel } from "@/components/remote-invocations-panel";
import { ResourceActivityPanel } from "@/components/resource-activity-panel";
import { useConfirm } from "@/lib/confirm-context";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1CollectionsByCollectionId,
	deleteApiV1CollectionsByCollectionIdPermissionsGroupByGroupId,
	getApiV1IamGroups,
	getApiV1IamMeGroups,
	getApiV1CollectionsByCollectionId,
	getApiV1CollectionsByCollectionIdPermissions,
	getApiV1CollectionsByCollectionIdPermissionsGroupByGroupId,
	patchApiV1CollectionsByCollectionId,
	putApiV1CollectionsByCollectionIdPermissionsGroupByGroupId,
} from "@/lib/api/generated/client";
import type {
	Group,
	GroupPermission,
	Collection,
	Permission,
	Permissions as PermissionName,
	UpdateCollection,
} from "@/lib/api/generated/models";
import { Permissions as PermissionValues } from "@/lib/api/generated/models/permissions";
import {
	EDIT_STATE_EVENT,
	type EditStateEventDetail,
	TITLE_STATE_EVENT,
} from "@/lib/create-events";

type CollectionDetailProps = {
	collectionId: number;
	currentUsername: string | null;
};

type PermissionFlagField =
	| "has_read_collection"
	| "has_update_collection"
	| "has_delete_collection"
	| "has_delegate_collection"
	| "has_create_class"
	| "has_read_class"
	| "has_update_class"
	| "has_delete_class"
	| "has_create_object"
	| "has_read_object"
	| "has_update_object"
	| "has_delete_object"
	| "has_create_class_relation"
	| "has_read_class_relation"
	| "has_update_class_relation"
	| "has_delete_class_relation"
	| "has_create_object_relation"
	| "has_read_object_relation"
	| "has_update_object_relation"
	| "has_delete_object_relation"
	| "has_create_template"
	| "has_read_template"
	| "has_update_template"
	| "has_delete_template"
	| "has_read_remote_target"
	| "has_create_remote_target"
	| "has_update_remote_target"
	| "has_delete_remote_target"
	| "has_execute_remote_target"
	| "has_read_audit"
	| "has_manage_event_subscription";

type PermissionDefinition = {
	value: PermissionName;
	label: string;
	field: PermissionFlagField;
	section: PermissionSection;
};

type PermissionSection =
	| "collection"
	| "class"
	| "object"
	| "class_relation"
	| "object_relation"
	| "template"
	| "remote_target"
	| "audit"
	| "events";

type EditableField = "name" | "description";

const ALL_EDITABLE_FIELDS: EditableField[] = ["name", "description"];

const PERMISSION_SECTION_LABELS: Record<PermissionSection, string> = {
	collection: "Collection",
	class: "Classes",
	object: "Objects",
	class_relation: "Class relations",
	object_relation: "Object relations",
	template: "Templates",
	remote_target: "Remote targets",
	audit: "Audit",
	events: "Events",
};

const PERMISSION_SECTION_ORDER: PermissionSection[] = [
	"collection",
	"class",
	"object",
	"class_relation",
	"object_relation",
	"template",
	"remote_target",
	"audit",
	"events",
];

const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
	{
		value: PermissionValues.ReadCollection,
		label: "Read collection",
		field: "has_read_collection",
		section: "collection",
	},
	{
		value: PermissionValues.UpdateCollection,
		label: "Update collection",
		field: "has_update_collection",
		section: "collection",
	},
	{
		value: PermissionValues.DeleteCollection,
		label: "Delete collection",
		field: "has_delete_collection",
		section: "collection",
	},
	{
		value: PermissionValues.DelegateCollection,
		label: "Delegate collection",
		field: "has_delegate_collection",
		section: "collection",
	},
	{
		value: PermissionValues.CreateClass,
		label: "Create class",
		field: "has_create_class",
		section: "class",
	},
	{
		value: PermissionValues.ReadClass,
		label: "Read class",
		field: "has_read_class",
		section: "class",
	},
	{
		value: PermissionValues.UpdateClass,
		label: "Update class",
		field: "has_update_class",
		section: "class",
	},
	{
		value: PermissionValues.DeleteClass,
		label: "Delete class",
		field: "has_delete_class",
		section: "class",
	},
	{
		value: PermissionValues.CreateObject,
		label: "Create object",
		field: "has_create_object",
		section: "object",
	},
	{
		value: PermissionValues.ReadObject,
		label: "Read object",
		field: "has_read_object",
		section: "object",
	},
	{
		value: PermissionValues.UpdateObject,
		label: "Update object",
		field: "has_update_object",
		section: "object",
	},
	{
		value: PermissionValues.DeleteObject,
		label: "Delete object",
		field: "has_delete_object",
		section: "object",
	},
	{
		value: PermissionValues.CreateClassRelation,
		label: "Create class relation",
		field: "has_create_class_relation",
		section: "class_relation",
	},
	{
		value: PermissionValues.ReadClassRelation,
		label: "Read class relation",
		field: "has_read_class_relation",
		section: "class_relation",
	},
	{
		value: PermissionValues.UpdateClassRelation,
		label: "Update class relation",
		field: "has_update_class_relation",
		section: "class_relation",
	},
	{
		value: PermissionValues.DeleteClassRelation,
		label: "Delete class relation",
		field: "has_delete_class_relation",
		section: "class_relation",
	},
	{
		value: PermissionValues.CreateObjectRelation,
		label: "Create object relation",
		field: "has_create_object_relation",
		section: "object_relation",
	},
	{
		value: PermissionValues.ReadObjectRelation,
		label: "Read object relation",
		field: "has_read_object_relation",
		section: "object_relation",
	},
	{
		value: PermissionValues.UpdateObjectRelation,
		label: "Update object relation",
		field: "has_update_object_relation",
		section: "object_relation",
	},
	{
		value: PermissionValues.DeleteObjectRelation,
		label: "Delete object relation",
		field: "has_delete_object_relation",
		section: "object_relation",
	},
	{
		value: PermissionValues.CreateTemplate,
		label: "Create template",
		field: "has_create_template",
		section: "template",
	},
	{
		value: PermissionValues.ReadTemplate,
		label: "Read template",
		field: "has_read_template",
		section: "template",
	},
	{
		value: PermissionValues.UpdateTemplate,
		label: "Update template",
		field: "has_update_template",
		section: "template",
	},
	{
		value: PermissionValues.DeleteTemplate,
		label: "Delete template",
		field: "has_delete_template",
		section: "template",
	},
	{
		value: PermissionValues.ReadRemoteTarget,
		label: "Read remote target",
		field: "has_read_remote_target",
		section: "remote_target",
	},
	{
		value: PermissionValues.CreateRemoteTarget,
		label: "Create remote target",
		field: "has_create_remote_target",
		section: "remote_target",
	},
	{
		value: PermissionValues.UpdateRemoteTarget,
		label: "Update remote target",
		field: "has_update_remote_target",
		section: "remote_target",
	},
	{
		value: PermissionValues.DeleteRemoteTarget,
		label: "Delete remote target",
		field: "has_delete_remote_target",
		section: "remote_target",
	},
	{
		value: PermissionValues.ExecuteRemoteTarget,
		label: "Execute remote target",
		field: "has_execute_remote_target",
		section: "remote_target",
	},
	{
		value: PermissionValues.ReadAudit,
		label: "Read audit",
		field: "has_read_audit",
		section: "audit",
	},
	{
		value: PermissionValues.ManageEventSubscription,
		label: "Manage event subscriptions",
		field: "has_manage_event_subscription",
		section: "events",
	},
];

async function fetchCollection(collectionId: number): Promise<Collection> {
	const response = await getApiV1CollectionsByCollectionId(collectionId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collection."),
		);
	}

	return response.data;
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

async function putCollectionPermissions(
	collectionId: number,
	groupId: number,
	permissions: PermissionName[],
): Promise<void> {
	const response =
		await putApiV1CollectionsByCollectionIdPermissionsGroupByGroupId(
			collectionId,
			groupId,
			permissions,
			{
				credentials: "include",
			},
		);

	if (response.status === 200) {
		return;
	}

	throw new Error(
		getApiErrorMessage(
			response.data,
			"Failed to update collection permissions.",
		),
	);
}

async function fetchCurrentUserGroups(_username: string): Promise<Group[]> {
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

function getEnabledPermissions(permissionRecord: Permission): PermissionName[] {
	return PERMISSION_DEFINITIONS.filter((definition) =>
		isPermissionEnabled(permissionRecord, definition.field),
	).map((definition) => definition.value);
}

type PermissionChip = {
	label: string;
	enabled: boolean;
};

function getPermissionChips(permissionRecord: Permission): PermissionChip[] {
	return PERMISSION_DEFINITIONS.map((definition) => ({
		label: definition.label,
		enabled: isPermissionEnabled(permissionRecord, definition.field),
	}));
}

function getSectionDefinitions(
	section: PermissionSection,
): PermissionDefinition[] {
	return PERMISSION_DEFINITIONS.filter(
		(definition) => definition.section === section,
	);
}

function summarizePermissions(permissionSet: Set<PermissionName>): string {
	const sectionSummaries = PERMISSION_SECTION_ORDER.map((section) => {
		const enabledLabels = getSectionDefinitions(section)
			.filter((definition) => permissionSet.has(definition.value))
			.map((definition) =>
				definition.label
					.replace(/^(Read|Update|Delete|Create|Delegate)\s+/i, "$1 ")
					.replace(/\s+(collection|class|object|relation|template)$/i, ""),
			);

		if (enabledLabels.length === 0) {
			return null;
		}

		return `${PERMISSION_SECTION_LABELS[section]}: ${enabledLabels.join(", ")}`;
	}).filter(Boolean);

	return sectionSummaries.length > 0
		? sectionSummaries.join(" · ")
		: "No permissions selected";
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

function isPermissionEnabled(
	permissionRecord: Permission,
	field: PermissionFlagField,
): boolean {
	return normalizePermissionFlag(permissionRecord[field] as unknown);
}

function hasAllSubmittedPermissions(
	submitted: PermissionName[],
	persisted: PermissionName[],
): boolean {
	const persistedSet = new Set(persisted);
	for (const permission of submitted) {
		if (!persistedSet.has(permission)) {
			return false;
		}
	}

	return true;
}

function arePermissionSetsEqual(
	left: PermissionName[],
	right: PermissionName[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}

	const rightSet = new Set(right);
	for (const permission of left) {
		if (!rightSet.has(permission)) {
			return false;
		}
	}

	return true;
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

export function CollectionDetail({
	collectionId,
	currentUsername,
}: CollectionDetailProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [editingFields, setEditingFields] = useState<EditableField[]>([]);
	const [addingGroupPermissions, setAddingGroupPermissions] = useState(false);
	const [newPermissionGroupId, setNewPermissionGroupId] = useState("");
	const [newSelectedPermissions, setNewSelectedPermissions] = useState<
		PermissionName[]
	>([]);
	const [permissionDrafts, setPermissionDrafts] = useState<
		Record<number, PermissionName[]>
	>({});
	const [permissionsError, setPermissionsError] = useState<string | null>(null);
	const [permissionsSuccess, setPermissionsSuccess] = useState<string | null>(
		null,
	);
	const [pendingRevokeGroupId, setPendingRevokeGroupId] = useState<
		number | null
	>(null);
	const [initialized, setInitialized] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const collectionQuery = useQuery({
		queryKey: ["collection", collectionId],
		queryFn: async () => fetchCollection(collectionId),
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "collection-permissions", collectionId],
		queryFn: fetchGroups,
	});
	const permissionsQuery = useQuery({
		queryKey: ["collection", collectionId, "permissions"],
		queryFn: async () => fetchCollectionPermissions(collectionId),
	});
	const currentUserGroupsQuery = useQuery({
		queryKey: ["permissions", "current-user-groups", currentUsername],
		queryFn: async () => {
			if (!currentUsername) {
				return [];
			}

			return fetchCurrentUserGroups(currentUsername);
		},
	});
	const updateMutation = useMutation({
		mutationFn: async (payload: UpdateCollection) => {
			const response = await patchApiV1CollectionsByCollectionId(
				collectionId,
				payload,
				{
					credentials: "include",
				},
			);

			if (response.status !== 202) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to update collection."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId],
			});
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			setEditingFields([]);
			setFormError(null);
			setFormSuccess("Collection updated.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to update collection.",
			);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async () => {
			const response = await deleteApiV1CollectionsByCollectionId(collectionId, {
				credentials: "include",
			});

			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to delete collection."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			router.push("/collections");
			router.refresh();
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to delete collection.",
			);
		},
	});
	const upsertPermissionsMutation = useMutation({
		mutationFn: async (payload: {
			groupId: number;
			permissions: PermissionName[];
			mode: "create" | "edit";
		}) => {
			await putCollectionPermissions(
				collectionId,
				payload.groupId,
				payload.permissions,
			);

			const verificationResponse =
				await getApiV1CollectionsByCollectionIdPermissionsGroupByGroupId(
					collectionId,
					payload.groupId,
					{
						credentials: "include",
					},
				);
			if (verificationResponse.status !== 200) {
				throw new Error(
					getApiErrorMessage(
						verificationResponse.data,
						"Permission update could not be verified.",
					),
				);
			}

			const persistedPermissions = getEnabledPermissions(
				verificationResponse.data,
			);
			if (
				!hasAllSubmittedPermissions(payload.permissions, persistedPermissions)
			) {
				throw new Error(
					"Permission update was accepted, but one or more submitted permissions are missing from the saved set.",
				);
			}
		},
		onSuccess: async (_, payload) => {
			await queryClient.refetchQueries({
				queryKey: ["collection", collectionId, "permissions"],
				exact: true,
				type: "active",
			});
			setPermissionsError(null);
			setPermissionsSuccess(
				payload.mode === "create"
					? "Permissions granted."
					: "Permissions updated.",
			);
			if (payload.mode === "create") {
				setAddingGroupPermissions(false);
				setNewPermissionGroupId("");
				setNewSelectedPermissions([]);
			} else {
				setPermissionDrafts((current) => {
					const next = { ...current };
					delete next[payload.groupId];
					return next;
				});
			}
		},
		onError: (error) => {
			setPermissionsSuccess(null);
			setPermissionsError(
				error instanceof Error
					? error.message
					: "Failed to update collection permissions.",
			);
		},
	});
	const revokePermissionsMutation = useMutation({
		mutationFn: async (groupId: number) => {
			const response =
				await deleteApiV1CollectionsByCollectionIdPermissionsGroupByGroupId(
					collectionId,
					groupId,
					{
						credentials: "include",
					},
				);

			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to revoke collection permissions.",
					),
				);
			}
		},
		onMutate: (groupId) => {
			setPendingRevokeGroupId(groupId);
			setPermissionsError(null);
			setPermissionsSuccess(null);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "permissions"],
			});
			setPermissionsError(null);
			setPermissionsSuccess("Permissions revoked.");
			if (pendingRevokeGroupId !== null) {
				setPermissionDrafts((current) => {
					const next = { ...current };
					delete next[pendingRevokeGroupId];
					return next;
				});
			}
		},
		onError: (error) => {
			setPermissionsSuccess(null);
			setPermissionsError(
				error instanceof Error
					? error.message
					: "Failed to revoke collection permissions.",
			);
		},
		onSettled: () => {
			setPendingRevokeGroupId(null);
		},
	});

	useEffect(() => {
		if (!collectionQuery.data) {
			return;
		}

		if (!initialized || editingFields.length === 0) {
			setName(collectionQuery.data.name);
			setDescription(collectionQuery.data.description ?? "");
			setInitialized(true);
		}
	}, [editingFields.length, initialized, collectionQuery.data]);

	function resetFieldDraft(field: EditableField, collectionData: Collection) {
		if (field === "name") {
			setName(collectionData.name);
			return;
		}

		setDescription(collectionData.description ?? "");
	}

	function toggleFieldEditing(field: EditableField, collectionData: Collection) {
		setFormError(null);
		setFormSuccess(null);

		if (editingFields.includes(field)) {
			resetFieldDraft(field, collectionData);
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
		const collectionData = collectionQuery.data;
		if (!collectionData || editingFields.length === 0) {
			return;
		}

		setName(collectionData.name);
		setDescription(collectionData.description ?? "");
		setEditingFields([]);
		setFormError(null);
		setFormSuccess(null);
	}, [editingFields.length, collectionQuery.data]);

	useEffect(() => {
		const detail: EditStateEventDetail = {
			label: "Edit collection",
			editHandler:
				!hasActiveEdits && !isSavingOrDeleting ? beginGlobalEdit : null,
		};

		window.dispatchEvent(new CustomEvent(EDIT_STATE_EVENT, { detail }));

		return () => {
			window.dispatchEvent(
				new CustomEvent(EDIT_STATE_EVENT, {
					detail: { label: "Edit collection", editHandler: null },
				}),
			);
		};
	}, [beginGlobalEdit, hasActiveEdits, isSavingOrDeleting]);

	useEffect(() => {
		const collectionData = collectionQuery.data;
		if (!collectionData) {
			return;
		}

		window.dispatchEvent(
			new CustomEvent(TITLE_STATE_EVENT, {
				detail: {
					title: collectionData.name,
					pin: {
						type: "collection",
						id: collectionData.id,
						name: collectionData.name,
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
	}, [collectionQuery.data]);

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

		updateMutation.mutate({
			name: name.trim(),
			description: description.trim(),
		});
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
		const collectionLabel = collectionQuery.data?.name ?? "this collection";
		const confirmed = await confirm({
			title: `Delete ${collectionLabel}?`,
			description: "This removes the collection and cannot be undone.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate();
	}

	function togglePermissionList(
		current: PermissionName[],
		permission: PermissionName,
		checked: boolean,
	): PermissionName[] {
		const currentSet = new Set(current);
		if (checked) {
			currentSet.add(permission);
		} else {
			currentSet.delete(permission);
		}

		return Array.from(currentSet);
	}

	function toggleNewPermission(permission: PermissionName, checked: boolean) {
		setNewSelectedPermissions((current) => {
			return togglePermissionList(current, permission, checked);
		});
	}

	function toggleRowPermission(
		entry: GroupPermission,
		permission: PermissionName,
		checked: boolean,
	) {
		const basePermissions = getEnabledPermissions(entry.permission);
		setPermissionDrafts((current) => {
			const currentPermissions = current[entry.group.id] ?? basePermissions;
			const nextPermissions = togglePermissionList(
				currentPermissions,
				permission,
				checked,
			);

			if (arePermissionSetsEqual(nextPermissions, basePermissions)) {
				const next = { ...current };
				delete next[entry.group.id];
				return next;
			}

			return {
				...current,
				[entry.group.id]: nextPermissions,
			};
		});
	}

	function onResetPermissionEditor() {
		setAddingGroupPermissions(false);
		setNewPermissionGroupId("");
		setNewSelectedPermissions([]);
		setPermissionDrafts({});
		setPermissionsError(null);
		setPermissionsSuccess(null);
	}

	function onStartAddPermissions() {
		setPermissionsError(null);
		setPermissionsSuccess(null);
		setNewSelectedPermissions([]);
		setAddingGroupPermissions(true);

		const groups = groupsQuery.data ?? [];
		const assignedGroupIds = new Set(
			(permissionsQuery.data ?? []).map((entry) => entry.group.id),
		);
		const availableGroups = groups.filter(
			(group) => !assignedGroupIds.has(group.id),
		);
		setNewPermissionGroupId(
			availableGroups.length > 0 ? String(availableGroups[0].id) : "",
		);
	}

	function onSaveRowPermissions(entry: GroupPermission) {
		setPermissionsError(null);
		setPermissionsSuccess(null);

		const rowPermissions =
			permissionDrafts[entry.group.id] ??
			getEnabledPermissions(entry.permission);
		if (rowPermissions.length === 0) {
			setPermissionsError("Select at least one permission, or use Revoke.");
			return;
		}

		upsertPermissionsMutation.mutate({
			groupId: entry.group.id,
			permissions: rowPermissions,
			mode: "edit",
		});
	}

	function onSaveNewPermissions() {
		setPermissionsError(null);
		setPermissionsSuccess(null);

		const parsedGroupId = Number.parseInt(newPermissionGroupId, 10);
		if (!Number.isFinite(parsedGroupId) || parsedGroupId < 1) {
			setPermissionsError("Group is required.");
			return;
		}

		if (newSelectedPermissions.length === 0) {
			setPermissionsError("Select at least one permission.");
			return;
		}

		upsertPermissionsMutation.mutate({
			groupId: parsedGroupId,
			permissions: newSelectedPermissions,
			mode: "create",
		});
	}

	function renderPermissionEditor(
		selectedPermissionSet: Set<PermissionName>,
		onToggle: (permission: PermissionName, checked: boolean) => void,
	) {
		return (
			<div className="permission-editor-grid">
				{PERMISSION_SECTION_ORDER.map((section) => (
					<section key={section} className="permission-section">
						<h4 className="permission-section-title">
							{PERMISSION_SECTION_LABELS[section]}
						</h4>
						<div className="permission-chip-list permission-chip-list--editor">
							{getSectionDefinitions(section).map((definition) => {
								const enabled = selectedPermissionSet.has(definition.value);
								return (
									<button
										key={definition.value}
										type="button"
										className={`permission-chip permission-chip-button permission-chip--editor ${
											enabled
												? "permission-chip--active"
												: "permission-chip--inactive"
										}`}
										onClick={() => onToggle(definition.value, !enabled)}
									>
										{definition.label}
									</button>
								);
							})}
						</div>
					</section>
				))}
			</div>
		);
	}

	async function onRevokePermissions(groupId: number) {
		const confirmed = await confirm({
			title: `Revoke permissions for group #${groupId}?`,
			description:
				"This removes every collection permission granted to the group.",
			confirmLabel: "Revoke",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		revokePermissionsMutation.mutate(groupId);
	}

	const groups = groupsQuery.data ?? [];
	const permissionEntries = permissionsQuery.data ?? [];
	const assignedGroupIds = new Set(
		permissionEntries.map((entry) => entry.group.id),
	);
	const availableGroups = groups.filter(
		(group) => !assignedGroupIds.has(group.id),
	);
	const usingGroupSelect = groups.length > 0 && !groupsQuery.isError;
	const currentUserGroupIds = new Set(
		(currentUserGroupsQuery.data ?? []).map((group) => group.id),
	);
	const canManagePermissions = permissionEntries.some(
		(entry) =>
			isPermissionEnabled(entry.permission, "has_delegate_collection") &&
			currentUserGroupIds.has(entry.group.id),
	);
	const canManageEventSubscriptions = permissionEntries.some(
		(entry) =>
			isPermissionEnabled(entry.permission, "has_manage_event_subscription") &&
			currentUserGroupIds.has(entry.group.id),
	);
	const newSelectedPermissionSet = new Set(newSelectedPermissions);
	const sortedPermissionEntries = [...permissionEntries].sort((left, right) =>
		left.group.groupname.localeCompare(right.group.groupname),
	);
	const canCheckPermissionMembership = Boolean(currentUsername);
	const checkingPermissionMembership =
		canCheckPermissionMembership &&
		(permissionsQuery.isLoading || currentUserGroupsQuery.isLoading);
	const hasAnyPermissionRows =
		sortedPermissionEntries.length > 0 ||
		(canManagePermissions && addingGroupPermissions);
	const hasDirtyRowDrafts = Object.keys(permissionDrafts).length > 0;

	useEffect(() => {
		if (!addingGroupPermissions || !usingGroupSelect) {
			return;
		}

		if (availableGroups.length === 0) {
			setNewPermissionGroupId("");
			return;
		}

		const currentGroupStillAvailable = availableGroups.some(
			(group) => String(group.id) === newPermissionGroupId,
		);
		if (!currentGroupStillAvailable) {
			setNewPermissionGroupId(String(availableGroups[0].id));
		}
	}, [
		addingGroupPermissions,
		availableGroups,
		newPermissionGroupId,
		usingGroupSelect,
	]);

	if (collectionQuery.isLoading) {
		return <div className="card">Loading collection...</div>;
	}

	if (collectionQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load collection.{" "}
				{collectionQuery.error instanceof Error
					? collectionQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const collectionData = collectionQuery.data;
	if (!collectionData) {
		return (
			<div className="card error-banner">Collection data is unavailable.</div>
		);
	}

	return (
		<>
			<CollectionDetailTracker
				collectionId={collectionId}
				collectionName={collectionData.name}
			/>
			<section className="stack">
				<form
					className="card stack"
					onSubmit={onSubmit}
					onKeyDownCapture={onSubmitShortcut}
				>
					<div className="object-meta-strip">
						<div className="object-meta-item">
							<span className="object-meta-label">Created</span>
							<span className="object-meta-value">
								{formatTimestamp(collectionData.created_at)}
							</span>
						</div>
						<div className="object-meta-item">
							<span className="object-meta-label">Updated</span>
							<span className="object-meta-value">
								{formatTimestamp(collectionData.updated_at)}
							</span>
						</div>
						<div className="object-meta-item">
							<span className="object-meta-label">Permission groups</span>
							<span className="object-meta-value">
								{permissionsQuery.isLoading
									? "Loading..."
									: `${sortedPermissionEntries.length}`}
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
										<span className="sr-only">Collection name</span>
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
										onClick={() => toggleFieldEditing("name", collectionData)}
									>
										<span className="object-detail-value">
											{renderFieldText(collectionData.name)}
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
										onClick={() => toggleFieldEditing("name", collectionData)}
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
										<span className="sr-only">Collection description</span>
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
										onClick={() =>
											toggleFieldEditing("description", collectionData)
										}
									>
										<span className="object-detail-value">
											{renderFieldText(collectionData.description ?? "")}
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
										onClick={() =>
											toggleFieldEditing("description", collectionData)
										}
									>
										Cancel
									</button>
								) : null}
							</div>
						</section>
					</div>

					{formError ? <div className="error-banner">{formError}</div> : null}
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
								{deleteMutation.isPending ? "Deleting..." : "Delete collection"}
							</button>
						)}
					</div>
				</form>

				<RemoteInvocationsPanel
					collectionId={collectionId}
					subject={{ type: "collection", collection_id: collectionId }}
					subjectLabel={`collection "${collectionData.name}"`}
					subjectType="collection"
				/>

				<ResourceActivityPanel
					scope={{ type: "collection", collectionId }}
					title="Collection audit and history"
				/>

				<CollectionEventSubscriptionsPanel
					collectionId={collectionId}
					canManage={canManageEventSubscriptions}
					isPermissionPending={checkingPermissionMembership}
				/>

				<section className="card stack">
					<header className="stack">
						<h3>Collection Permissions</h3>
						<p className="muted">
							{checkingPermissionMembership
								? "Checking whether you can modify collection permissions..."
								: canManagePermissions
									? "You can grant, update, and revoke permission sets for groups on this collection."
									: canCheckPermissionMembership
										? "You can view permissions, but you cannot modify them with your current access."
										: "Could not identify the current user. Showing read-only permissions."}
						</p>
					</header>

					{canManagePermissions ? (
						<div className="form-actions">
							<button
								type="button"
								className="ghost"
								onClick={onStartAddPermissions}
								disabled={
									addingGroupPermissions ||
									hasDirtyRowDrafts ||
									upsertPermissionsMutation.isPending ||
									(usingGroupSelect && availableGroups.length === 0)
								}
							>
								{usingGroupSelect && availableGroups.length === 0
									? "All groups assigned"
									: "Add group permissions"}
							</button>
							{groupsQuery.isError ? (
								<span className="muted">
									Could not load groups automatically. You can enter a group ID
									manually.
								</span>
							) : null}
						</div>
					) : null}

					{permissionsError ? (
						<div className="error-banner">{permissionsError}</div>
					) : null}
					{permissionsSuccess ? (
						<div className="muted">{permissionsSuccess}</div>
					) : null}

					{permissionsQuery.isLoading ? (
						<div className="muted">Loading collection permissions...</div>
					) : permissionsQuery.isError ? (
						<div className="error-banner">
							Failed to load collection permissions.{" "}
							{permissionsQuery.error instanceof Error
								? permissionsQuery.error.message
								: "Unknown error"}
						</div>
					) : !hasAnyPermissionRows ? (
						<EmptyState
							title="No group permissions assigned."
							description="Grant permissions to a group before members can use this collection through group access."
							action={
								canManagePermissions ? (
									<button
										type="button"
										className="ghost"
										onClick={onStartAddPermissions}
										disabled={addingGroupPermissions}
									>
										Add group permissions
									</button>
								) : null
							}
						/>
					) : (
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>Group</th>
										<th>Permissions</th>
										<th>Updated</th>
										{canManagePermissions ? <th>Actions</th> : null}
									</tr>
								</thead>
								<tbody>
									{canManagePermissions && addingGroupPermissions ? (
										<tr>
											<td>
												{usingGroupSelect ? (
													availableGroups.length > 0 ? (
														<select
															value={newPermissionGroupId}
															onChange={(event) =>
																setNewPermissionGroupId(event.target.value)
															}
															aria-label="Select group to grant permissions"
														>
															{availableGroups.map((group) => (
																<option key={group.id} value={group.id}>
																	{group.groupname} (#{group.id})
																</option>
															))}
														</select>
													) : (
														<span className="muted">
															All groups already have permissions.
														</span>
													)
												) : (
													<input
														type="number"
														min={1}
														value={newPermissionGroupId}
														onChange={(event) =>
															setNewPermissionGroupId(event.target.value)
														}
														placeholder={
															groupsQuery.isLoading
																? "Loading groups..."
																: "Enter group ID"
														}
														disabled={groupsQuery.isLoading}
														required
													/>
												)}
											</td>
											<td>
												<div className="permission-summary">
													{summarizePermissions(newSelectedPermissionSet)}
												</div>
												{renderPermissionEditor(
													newSelectedPermissionSet,
													toggleNewPermission,
												)}
											</td>
											<td>-</td>
											<td>
												<div className="table-tools permission-table-tools">
													<div className="permission-action-stack">
														<button
															type="button"
															onClick={onSaveNewPermissions}
															disabled={
																upsertPermissionsMutation.isPending ||
																newSelectedPermissions.length === 0 ||
																(usingGroupSelect &&
																	availableGroups.length === 0)
															}
														>
															{upsertPermissionsMutation.isPending
																? "Saving..."
																: "Grant"}
														</button>
														<button
															type="button"
															className="ghost"
															onClick={onResetPermissionEditor}
															disabled={upsertPermissionsMutation.isPending}
														>
															Cancel
														</button>
													</div>
												</div>
											</td>
										</tr>
									) : null}
									{sortedPermissionEntries.map((entry) => {
										const basePermissions = getEnabledPermissions(
											entry.permission,
										);
										const draftPermissions =
											permissionDrafts[entry.group.id] ?? basePermissions;
										const draftPermissionSet = new Set(draftPermissions);
										const basePermissionSet = new Set(basePermissions);
										const isRowDirty = Object.hasOwn(
											permissionDrafts,
											entry.group.id,
										);
										const isSavingRow =
											upsertPermissionsMutation.isPending && isRowDirty;
										const chips = getPermissionChips(entry.permission);
										const isRevokePending =
											revokePermissionsMutation.isPending &&
											pendingRevokeGroupId !== null &&
											pendingRevokeGroupId === entry.group.id;
										const revokeDisabled =
											isRevokePending ||
											upsertPermissionsMutation.isPending ||
											addingGroupPermissions ||
											isRowDirty;
										const actionDisabled =
											!isRowDirty ||
											upsertPermissionsMutation.isPending ||
											addingGroupPermissions;

										return (
											<tr key={entry.permission.id}>
												<td>
													{entry.group.groupname} (#{entry.group.id})
												</td>
												<td>
													<div className="permission-summary">
														{summarizePermissions(
															canManagePermissions
																? draftPermissionSet
																: basePermissionSet,
														)}
													</div>
													{canManagePermissions ? (
														renderPermissionEditor(
															draftPermissionSet,
															(permission, checked) =>
																toggleRowPermission(entry, permission, checked),
														)
													) : chips.length > 0 ? (
														<div className="permission-chip-list">
															{chips.map((chip) => (
																<span
																	key={chip.label}
																	className={`permission-chip ${chip.enabled ? "permission-chip--active" : "permission-chip--inactive"}`}
																>
																	{chip.label}
																</span>
															))}
														</div>
													) : (
														"-"
													)}
												</td>
												<td>
													{new Date(
														entry.permission.updated_at,
													).toLocaleString()}
												</td>
												{canManagePermissions ? (
													<td>
														<div className="table-tools permission-table-tools">
															<div className="permission-action-stack">
																<button
																	type="button"
																	className="ghost"
																	onClick={() => onSaveRowPermissions(entry)}
																	disabled={actionDisabled}
																>
																	{isSavingRow
																		? "Saving..."
																		: isRowDirty
																			? "Save"
																			: "Edit"}
																</button>
																{isRowDirty ? (
																	<button
																		type="button"
																		className="ghost"
																		onClick={() =>
																			setPermissionDrafts((current) => {
																				const next = { ...current };
																				delete next[entry.group.id];
																				return next;
																			})
																		}
																		disabled={
																			upsertPermissionsMutation.isPending
																		}
																	>
																		Cancel
																	</button>
																) : null}
															</div>
															<button
																type="button"
																className="danger"
																onClick={() =>
																	onRevokePermissions(entry.group.id)
																}
																disabled={revokeDisabled}
															>
																{isRevokePending ? "Revoking..." : "Revoke"}
															</button>
														</div>
													</td>
												) : null}
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</section>
		</>
	);
}
