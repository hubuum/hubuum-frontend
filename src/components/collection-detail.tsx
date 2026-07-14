"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { EmptyState } from "@/components/empty-state";
import { CollectionEventSubscriptionsPanel } from "@/components/collection-event-subscriptions-panel";
import { CollectionDetailTracker } from "@/components/collection-detail-tracker";
import { InlineFieldEditTrigger } from "@/components/inline-field-edit-trigger";
import { RemoteInvocationsPanel } from "@/components/remote-invocations-panel";
import { ResourceActivityPanel } from "@/components/resource-activity-panel";
import { TableExportMenu } from "@/components/table-export-menu";
import { useConfirm } from "@/lib/confirm-context";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1CollectionsByCollectionId,
	deleteApiV1CollectionsByCollectionIdPermissionsGroupByGroupId,
	getApiV1IamGroups,
	getApiV1IamMeGroups,
	getApiV1Collections,
	getApiV1CollectionsByCollectionId,
	getApiV1CollectionsByCollectionIdAncestors,
	getApiV1CollectionsByCollectionIdChildren,
	getApiV1CollectionsByCollectionIdHasPermissionsByPermission,
	getApiV1CollectionsByCollectionIdPermissions,
	getApiV1CollectionsByCollectionIdPermissionsEffectivePrincipalByPrincipalId,
	getApiV1CollectionsByCollectionIdPermissionsGroupByGroupId,
	patchApiV1CollectionsByCollectionId,
	putApiV1CollectionsByCollectionIdParent,
	putApiV1CollectionsByCollectionIdPermissionsGroupByGroupId,
} from "@/lib/api/generated/client";
import type {
	EffectiveGroupPermission,
	GroupPermission,
	Collection,
	Permission,
	Permissions as PermissionName,
	UpdateCollection,
} from "@/lib/api/generated/models";
import { Permissions as PermissionValues } from "@/lib/api/generated/models/permissions";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
	formatCollectionPath,
	getDescendantCollectionIds,
	isRootCollection,
} from "@/lib/collection-hierarchy";
import {
	EDIT_STATE_EVENT,
	type EditStateEventDetail,
	TITLE_STATE_EVENT,
} from "@/lib/create-events";
import {
	type ConsoleGroup,
	formatScopedGroupName,
} from "@/lib/identity-scopes";
import { canManageCollectionPermissions } from "@/lib/collection-permission-access";
import { useCurrentUserId } from "@/lib/use-current-user-id";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

type CollectionDetailProps = {
	canAdminister: boolean;
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

type PermissionExportRow = {
	group: string;
	permissions: string;
	updated: string;
};

type EffectivePermissionExportRow = {
	sourceCollection: string;
	group: string;
	type: string;
	permissions: string;
};

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

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections(
		{ limit: 250, include_total: false },
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

async function fetchCollectionChildren(
	collectionId: number,
): Promise<Collection[]> {
	const response = await getApiV1CollectionsByCollectionIdChildren(
		collectionId,
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load child collections."),
		);
	}

	return response.data;
}

async function fetchCollectionAncestors(
	collectionId: number,
): Promise<Collection[]> {
	const response = await getApiV1CollectionsByCollectionIdAncestors(
		collectionId,
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collection path."),
		);
	}

	return response.data;
}

async function fetchGroups(): Promise<ConsoleGroup[]> {
	const response = await getApiV1IamGroups(
		{ include_total: false },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load groups."),
		);
	}

	return response.data;
}

async function fetchEffectivePrincipalPermissions(
	collectionId: number,
	principalId: number,
): Promise<EffectiveGroupPermission[]> {
	const response =
		await getApiV1CollectionsByCollectionIdPermissionsEffectivePrincipalByPrincipalId(
			collectionId,
			principalId,
			{
				credentials: "include",
			},
		);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to load effective collection permissions.",
			),
		);
	}

	return response.data;
}

async function fetchGroupsWithPermission(
	collectionId: number,
	permission: PermissionName,
): Promise<ConsoleGroup[]> {
	const response =
		await getApiV1CollectionsByCollectionIdHasPermissionsByPermission(
			collectionId,
			permission,
			undefined,
			{
				credentials: "include",
			},
		);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to check collection access."),
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

export function CollectionDetail({
	canAdminister,
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
	const nameInputRef = useRef<HTMLInputElement | null>(null);
	const descriptionInputRef = useRef<HTMLInputElement | null>(null);
	const [moveParentId, setMoveParentId] = useState("");
	const [moveError, setMoveError] = useState<string | null>(null);
	const [moveSuccess, setMoveSuccess] = useState<string | null>(null);
	const currentUserId = useCurrentUserId(currentUsername);

	const collectionQuery = useQuery({
		queryKey: ["collection", collectionId],
		queryFn: async () => fetchCollection(collectionId),
	});
	const collectionsQuery = useQuery({
		queryKey: ["collections", "collection-detail", collectionId],
		queryFn: fetchCollections,
	});
	const childrenQuery = useQuery({
		queryKey: ["collection", collectionId, "children"],
		queryFn: async () => fetchCollectionChildren(collectionId),
	});
	const ancestorsQuery = useQuery({
		queryKey: ["collection", collectionId, "ancestors"],
		queryFn: async () => fetchCollectionAncestors(collectionId),
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "collection-permissions", collectionId],
		queryFn: fetchGroups,
	});
	const permissionsQuery = useQuery({
		queryKey: ["collection", collectionId, "permissions"],
		queryFn: async () => fetchCollectionPermissions(collectionId),
	});
	const effectivePermissionsQuery = useQuery({
		queryKey: [
			"collection",
			collectionId,
			"effective-permissions",
			currentUserId,
		],
		queryFn: async () => {
			if (!currentUserId) {
				return [];
			}

			return fetchEffectivePrincipalPermissions(collectionId, currentUserId);
		},
		enabled: Boolean(currentUserId),
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
	const delegateGroupsQuery = useQuery({
		queryKey: [
			"collection",
			collectionId,
			"has-permission",
			PermissionValues.DelegateCollection,
		],
		queryFn: async () =>
			fetchGroupsWithPermission(
				collectionId,
				PermissionValues.DelegateCollection,
			),
	});
	const updateGroupsQuery = useQuery({
		queryKey: [
			"collection",
			collectionId,
			"has-permission",
			PermissionValues.UpdateCollection,
		],
		queryFn: async () =>
			fetchGroupsWithPermission(
				collectionId,
				PermissionValues.UpdateCollection,
			),
	});
	const deleteGroupsQuery = useQuery({
		queryKey: [
			"collection",
			collectionId,
			"has-permission",
			PermissionValues.DeleteCollection,
		],
		queryFn: async () =>
			fetchGroupsWithPermission(
				collectionId,
				PermissionValues.DeleteCollection,
			),
	});
	const manageEventSubscriptionGroupsQuery = useQuery({
		queryKey: [
			"collection",
			collectionId,
			"has-permission",
			PermissionValues.ManageEventSubscription,
		],
		queryFn: async () =>
			fetchGroupsWithPermission(
				collectionId,
				PermissionValues.ManageEventSubscription,
			),
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
			const response = await deleteApiV1CollectionsByCollectionId(
				collectionId,
				{
					credentials: "include",
				},
			);

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
	const moveMutation = useMutation({
		mutationFn: async (parentCollectionId: number) => {
			const response = await putApiV1CollectionsByCollectionIdParent(
				collectionId,
				{ parent_collection_id: parentCollectionId },
				{
					credentials: "include",
				},
			);

			if (response.status !== 202) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to move collection."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId],
			});
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "children"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "ancestors"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "permissions"],
			});
			setMoveError(null);
			setMoveSuccess("Collection moved.");
		},
		onError: (error) => {
			setMoveSuccess(null);
			setMoveError(
				error instanceof Error ? error.message : "Failed to move collection.",
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
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "effective-permissions"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "has-permission"],
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
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "effective-permissions"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["collection", collectionId, "has-permission"],
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

	useEffect(() => {
		const lastEditingField = editingFields.at(-1);
		if (lastEditingField === "name") {
			nameInputRef.current?.focus();
		} else if (lastEditingField === "description") {
			descriptionInputRef.current?.focus();
		}
	}, [editingFields]);

	useEffect(() => {
		if (!collectionQuery.data) {
			return;
		}

		setMoveParentId(
			collectionQuery.data.parent_collection_id
				? String(collectionQuery.data.parent_collection_id)
				: "",
		);
	}, [collectionQuery.data]);

	function resetFieldDraft(field: EditableField, collectionData: Collection) {
		if (field === "name") {
			setName(collectionData.name);
			return;
		}

		setDescription(collectionData.description ?? "");
	}

	function toggleFieldEditing(
		field: EditableField,
		collectionData: Collection,
	) {
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

	useEscapeToCancel({
		enabled: hasActiveEdits && !isSavingOrDeleting,
		onCancel: cancelActiveEdits,
	});

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
		const collectionData = collectionQuery.data;
		if (collectionData && isRootCollection(collectionData)) {
			setFormError("The root collection cannot be deleted.");
			return;
		}
		if ((childrenQuery.data?.length ?? 0) > 0) {
			setFormError(
				"Move or delete this collection's child collections before deleting it.",
			);
			return;
		}
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

	function onMoveCollection(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setMoveError(null);
		setMoveSuccess(null);

		const collectionData = collectionQuery.data;
		if (!collectionData) {
			setMoveError("Collection data is unavailable.");
			return;
		}
		if (isRootCollection(collectionData)) {
			setMoveError("The root collection cannot be moved.");
			return;
		}

		const parsedParentId = Number.parseInt(moveParentId, 10);
		if (!Number.isFinite(parsedParentId) || parsedParentId < 1) {
			setMoveError("Select a parent collection.");
			return;
		}
		if (parsedParentId === collectionId) {
			setMoveError("A collection cannot be its own parent.");
			return;
		}

		moveMutation.mutate(parsedParentId);
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
	const userHasAnyGroup = (accessGroups: readonly ConsoleGroup[] | undefined) =>
		(accessGroups ?? []).some((group) => currentUserGroupIds.has(group.id));
	const canManagePermissions = canManageCollectionPermissions(
		canAdminister,
		userHasAnyGroup(delegateGroupsQuery.data),
	);
	const canUpdateCollection = userHasAnyGroup(updateGroupsQuery.data);
	const canDeleteCollection = userHasAnyGroup(deleteGroupsQuery.data);
	const canManageEventSubscriptions = userHasAnyGroup(
		manageEventSubscriptionGroupsQuery.data,
	);
	const collections = collectionsQuery.data ?? [];
	const collectionHierarchy = useMemo(
		() => buildCollectionHierarchy(collections),
		[collections],
	);
	const descendants = useMemo(
		() =>
			getDescendantCollectionIds(
				collectionId,
				collectionHierarchy.childrenByParentId,
			),
		[collectionHierarchy.childrenByParentId, collectionId],
	);
	const moveParentOptions = collectionHierarchy.flatNodes
		.map((node) => node.collection)
		.filter(
			(collection) =>
				collection.id !== collectionId && !descendants.has(collection.id),
		);
	const ancestorPath = [
		...(ancestorsQuery.data ?? []).slice().reverse(),
		...(collectionQuery.data ? [collectionQuery.data] : []),
	];
	const parentCollection = ancestorsQuery.data?.[0] ?? null;
	const childCollections = childrenQuery.data ?? [];
	const isRoot = collectionQuery.data
		? isRootCollection(collectionQuery.data)
		: false;
	const canMoveCollection =
		!isRoot && canUpdateCollection && canManagePermissions;
	const effectivePermissionEntries = effectivePermissionsQuery.data ?? [];
	const sortedEffectivePermissionEntries = [...effectivePermissionEntries].sort(
		(left, right) =>
			left.depth - right.depth ||
			left.source_collection.name.localeCompare(right.source_collection.name) ||
			left.group.groupname.localeCompare(right.group.groupname),
	);
	const newSelectedPermissionSet = new Set(newSelectedPermissions);
	const sortedPermissionEntries = [...permissionEntries].sort((left, right) =>
		left.group.groupname.localeCompare(right.group.groupname),
	);
	const canCheckPermissionMembership = Boolean(currentUsername);
	const checkingPermissionMembership =
		canCheckPermissionMembership &&
		(currentUserGroupsQuery.isLoading ||
			delegateGroupsQuery.isLoading ||
			manageEventSubscriptionGroupsQuery.isLoading);
	const hasAnyPermissionRows =
		sortedPermissionEntries.length > 0 ||
		(canManagePermissions && addingGroupPermissions);
	const hasDirtyRowDrafts = Object.keys(permissionDrafts).length > 0;
	useEscapeToCancel({
		enabled:
			(addingGroupPermissions || hasDirtyRowDrafts) &&
			!upsertPermissionsMutation.isPending,
		onCancel: onResetPermissionEditor,
	});

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

	const selectedNewPermissionGroup = availableGroups.find(
		(group) => String(group.id) === newPermissionGroupId,
	);
	const directPermissionExportRows: PermissionExportRow[] = [
		...(canManagePermissions && addingGroupPermissions
			? [
					{
						group: usingGroupSelect
							? selectedNewPermissionGroup
								? `${formatScopedGroupName(selectedNewPermissionGroup)} (#${selectedNewPermissionGroup.id})`
								: "All groups already have permissions."
							: newPermissionGroupId,
						permissions: summarizePermissions(newSelectedPermissionSet),
						updated: "-",
					},
				]
			: []),
		...sortedPermissionEntries.map((entry) => {
			const basePermissions = getEnabledPermissions(entry.permission);
			const displayedPermissions = canManagePermissions
				? new Set(permissionDrafts[entry.group.id] ?? basePermissions)
				: new Set(basePermissions);

			return {
				group: `${entry.group.groupname} (#${entry.group.id})`,
				permissions: summarizePermissions(displayedPermissions),
				updated: new Date(entry.permission.updated_at).toLocaleString(),
			};
		}),
	];
	const directPermissionExportView = {
		id: `collection-${collectionId}-direct-permissions`,
		fileName: `${collectionData.name}-direct-permissions`,
		sheetName: "Direct permissions",
		columns: [
			{
				key: "group",
				label: "Group",
				getValue: (row: PermissionExportRow) => row.group,
			},
			{
				key: "permissions",
				label: "Permissions",
				getValue: (row: PermissionExportRow) => row.permissions,
			},
			{
				key: "updated",
				label: "Updated",
				getValue: (row: PermissionExportRow) => row.updated,
			},
		],
		rows: directPermissionExportRows,
	};
	const effectivePermissionExportRows: EffectivePermissionExportRow[] =
		sortedEffectivePermissionEntries.map((entry) => ({
			sourceCollection: `${entry.source_collection.name} (#${entry.source_collection.id})`,
			group: `${entry.group.groupname} (#${entry.group.id})`,
			type: entry.inherited ? `Inherited, depth ${entry.depth}` : "Direct",
			permissions: summarizePermissions(
				new Set(getEnabledPermissions(entry.permission)),
			),
		}));
	const effectivePermissionExportView = {
		id: `collection-${collectionId}-effective-permissions`,
		fileName: `${collectionData.name}-effective-permissions`,
		sheetName: "Effective permissions",
		columns: [
			{
				key: "source_collection",
				label: "Source collection",
				getValue: (row: EffectivePermissionExportRow) => row.sourceCollection,
			},
			{
				key: "group",
				label: "Group",
				getValue: (row: EffectivePermissionExportRow) => row.group,
			},
			{
				key: "type",
				label: "Type",
				getValue: (row: EffectivePermissionExportRow) => row.type,
			},
			{
				key: "permissions",
				label: "Permissions",
				getValue: (row: EffectivePermissionExportRow) => row.permissions,
			},
		],
		rows: effectivePermissionExportRows,
	};

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
						<div className="object-meta-item">
							<span className="object-meta-label">Children</span>
							<span className="object-meta-value">
								{childrenQuery.isLoading
									? "Loading..."
									: `${childCollections.length}`}
							</span>
						</div>
					</div>

					<div className="object-detail-list">
						<section className="object-detail-row">
							<div className="object-detail-label">Path</div>
							<div className="object-detail-body">
								<span className="object-detail-value">
									{ancestorPath.length > 0
										? formatCollectionPath(ancestorPath)
										: `${collectionData.name} (#${collectionData.id})`}
								</span>
							</div>
							<div className="object-detail-row-actions" />
						</section>

						<section
							className={`object-detail-row${editingFields.includes("name") ? " is-editing" : ""}`}
						>
							<div className="object-detail-label">Name</div>
							<div className="object-detail-body">
								{editingFields.includes("name") ? (
									<label className="control-field">
										<span className="sr-only">Collection name</span>
										<input
											ref={nameInputRef}
											required
											value={name}
											onChange={(event) => setName(event.target.value)}
										/>
									</label>
								) : (
									<InlineFieldEditTrigger
										fieldLabel="collection name"
										valueText={renderFieldText(collectionData.name)}
										onClick={() => toggleFieldEditing("name", collectionData)}
									>
										{renderFieldText(collectionData.name)}
									</InlineFieldEditTrigger>
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
											ref={descriptionInputRef}
											required
											value={description}
											onChange={(event) => setDescription(event.target.value)}
										/>
									</label>
								) : (
									<InlineFieldEditTrigger
										fieldLabel="collection description"
										valueText={renderFieldText(
											collectionData.description ?? "",
										)}
										onClick={() =>
											toggleFieldEditing("description", collectionData)
										}
									>
										{renderFieldText(collectionData.description ?? "")}
									</InlineFieldEditTrigger>
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

						<section className="object-detail-row">
							<div className="object-detail-label">Parent</div>
							<div className="object-detail-body">
								{collectionData.parent_collection_id ? (
									<Link
										href={`/collections/${collectionData.parent_collection_id}`}
										className="row-link"
									>
										{parentCollection
											? `${parentCollection.name} (#${parentCollection.id})`
											: `Collection #${collectionData.parent_collection_id}`}
									</Link>
								) : (
									<span className="object-detail-value">Root collection</span>
								)}
							</div>
							<div className="object-detail-row-actions" />
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
								disabled={
									deleteMutation.isPending ||
									isRoot ||
									!canDeleteCollection ||
									childCollections.length > 0
								}
							>
								{deleteMutation.isPending ? "Deleting..." : "Delete collection"}
							</button>
						)}
					</div>
				</form>

				<section className="card stack">
					<header className="stack">
						<h3>Collection hierarchy</h3>
						<p className="muted">
							Collections inherit permissions from their ancestors. Moving a
							collection changes inherited access for the collection and its
							descendants.
						</p>
					</header>

					{ancestorsQuery.isError ? (
						<div className="error-banner">
							Failed to load collection path.{" "}
							{ancestorsQuery.error instanceof Error
								? ancestorsQuery.error.message
								: "Unknown error"}
						</div>
					) : null}

					<div className="object-detail-list">
						<section className="object-detail-row">
							<div className="object-detail-label">Direct children</div>
							<div className="object-detail-body">
								{childrenQuery.isLoading ? (
									<span className="muted">Loading child collections...</span>
								) : childrenQuery.isError ? (
									<span className="error-banner">
										Failed to load child collections.
									</span>
								) : childCollections.length > 0 ? (
									<div className="chip-row">
										{childCollections.map((child) => (
											<Link
												key={child.id}
												href={`/collections/${child.id}`}
												className="badge badge-link"
											>
												{child.name} (#{child.id})
											</Link>
										))}
									</div>
								) : (
									<span className="muted">No direct children.</span>
								)}
							</div>
							<div className="object-detail-row-actions" />
						</section>
					</div>

					<form className="form-grid" onSubmit={onMoveCollection}>
						<label className="control-field control-field--wide">
							<span>Move under parent</span>
							<select
								value={moveParentId}
								onChange={(event) => setMoveParentId(event.target.value)}
								disabled={
									!canMoveCollection ||
									moveMutation.isPending ||
									collectionsQuery.isLoading ||
									moveParentOptions.length === 0
								}
							>
								<option value="">
									{isRoot
										? "Root collection cannot be moved"
										: collectionsQuery.isLoading
											? "Loading collections..."
											: "Select parent collection"}
								</option>
								{moveParentOptions.map((collection) => (
									<option key={collection.id} value={collection.id}>
										{formatCollectionOption(
											collection,
											collectionHierarchy.byId,
										)}
									</option>
								))}
							</select>
						</label>

						<div className="form-actions">
							<button
								type="submit"
								disabled={
									!canMoveCollection ||
									moveMutation.isPending ||
									!moveParentId ||
									moveParentId ===
										String(collectionData.parent_collection_id ?? "")
								}
							>
								{moveMutation.isPending ? "Moving..." : "Move collection"}
							</button>
						</div>
					</form>

					{moveError ? <div className="error-banner">{moveError}</div> : null}
					{moveSuccess ? <div className="muted">{moveSuccess}</div> : null}
					{!canMoveCollection && !isRoot ? (
						<div className="muted">
							Moving requires inherited update access on this collection and
							delegate access on the involved parents.
						</div>
					) : null}
				</section>

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
						<h3>Collection permissions</h3>
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

					<div className="panel-header">
						<h4>Direct permissions</h4>
						<TableExportMenu
							view={directPermissionExportView}
							disabled={permissionsQuery.isFetching}
							compact
						/>
					</div>
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
																	{formatScopedGroupName(group)} (#{group.id})
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

					<div className="panel-header">
						<h4>Effective permissions for you</h4>
						<TableExportMenu
							view={effectivePermissionExportView}
							disabled={effectivePermissionsQuery.isFetching}
							compact
						/>
					</div>
					{!currentUserId ? (
						<div className="muted">
							Could not identify the current principal, so inherited permissions
							cannot be shown here.
						</div>
					) : effectivePermissionsQuery.isLoading ? (
						<div className="muted">Loading effective permissions...</div>
					) : effectivePermissionsQuery.isError ? (
						<div className="error-banner">
							Failed to load effective permissions.{" "}
							{effectivePermissionsQuery.error instanceof Error
								? effectivePermissionsQuery.error.message
								: "Unknown error"}
						</div>
					) : sortedEffectivePermissionEntries.length === 0 ? (
						<div className="muted">
							No effective permissions are visible for your principal.
						</div>
					) : (
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>Source collection</th>
										<th>Group</th>
										<th>Type</th>
										<th>Permissions</th>
									</tr>
								</thead>
								<tbody>
									{sortedEffectivePermissionEntries.map((entry) => {
										const enabledPermissions = new Set(
											getEnabledPermissions(entry.permission),
										);
										return (
											<tr
												key={`${entry.source_collection.id}-${entry.group.id}-${entry.permission.id}`}
											>
												<td>
													<Link
														href={`/collections/${entry.source_collection.id}`}
														className="row-link"
													>
														{entry.source_collection.name} (#
														{entry.source_collection.id})
													</Link>
												</td>
												<td>
													{entry.group.groupname} (#{entry.group.id})
												</td>
												<td>
													{entry.inherited
														? `Inherited, depth ${entry.depth}`
														: "Direct"}
												</td>
												<td>
													<div className="permission-summary">
														{summarizePermissions(enabledPermissions)}
													</div>
												</td>
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
