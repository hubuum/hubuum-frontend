"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteApiV1NamespacesByNamespaceId,
  deleteApiV1NamespacesByNamespaceIdPermissionsGroupByGroupId,
  getApiV1IamGroups,
  getApiV1IamUsers,
  getApiV1IamUsersByUserIdGroups,
  getApiV1NamespacesByNamespaceId,
  getApiV1NamespacesByNamespaceIdPermissions,
  getApiV1NamespacesByNamespaceIdPermissionsGroupByGroupId,
  patchApiV1NamespacesByNamespaceId,
} from "@/lib/api/generated/client";
import { Permissions as PermissionValues } from "@/lib/api/generated/models/permissions";
import type {
  Group,
  GroupPermission,
  Namespace,
  Permission,
  Permissions as PermissionName,
  UpdateNamespace
} from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

type NamespaceDetailProps = {
  namespaceId: number;
  currentUsername: string | null;
};

type PermissionFlagField =
  | "has_read_namespace"
  | "has_update_namespace"
  | "has_delete_namespace"
  | "has_delegate_namespace"
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
  | "has_delete_object_relation";

type PermissionDefinition = {
  value: PermissionName;
  label: string;
  field: PermissionFlagField;
  section: PermissionSection;
};

type PermissionSection = "namespace" | "class" | "object" | "class_relation" | "object_relation";

const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    value: PermissionValues.ReadCollection,
    label: "Read namespace",
    field: "has_read_namespace",
    section: "namespace"
  },
  {
    value: PermissionValues.UpdateCollection,
    label: "Update namespace",
    field: "has_update_namespace",
    section: "namespace"
  },
  {
    value: PermissionValues.DeleteCollection,
    label: "Delete namespace",
    field: "has_delete_namespace",
    section: "namespace"
  },
  {
    value: PermissionValues.DelegateCollection,
    label: "Delegate namespace",
    field: "has_delegate_namespace",
    section: "namespace"
  },
  { value: PermissionValues.CreateClass, label: "Create class", field: "has_create_class", section: "class" },
  { value: PermissionValues.ReadClass, label: "Read class", field: "has_read_class", section: "class" },
  { value: PermissionValues.UpdateClass, label: "Update class", field: "has_update_class", section: "class" },
  { value: PermissionValues.DeleteClass, label: "Delete class", field: "has_delete_class", section: "class" },
  {
    value: PermissionValues.CreateObject,
    label: "Create object",
    field: "has_create_object",
    section: "object"
  },
  { value: PermissionValues.ReadObject, label: "Read object", field: "has_read_object", section: "object" },
  {
    value: PermissionValues.UpdateObject,
    label: "Update object",
    field: "has_update_object",
    section: "object"
  },
  {
    value: PermissionValues.DeleteObject,
    label: "Delete object",
    field: "has_delete_object",
    section: "object"
  },
  {
    value: PermissionValues.CreateClassRelation,
    label: "Create class relation",
    field: "has_create_class_relation",
    section: "class_relation"
  },
  {
    value: PermissionValues.ReadClassRelation,
    label: "Read class relation",
    field: "has_read_class_relation",
    section: "class_relation"
  },
  {
    value: PermissionValues.UpdateClassRelation,
    label: "Update class relation",
    field: "has_update_class_relation",
    section: "class_relation"
  },
  {
    value: PermissionValues.DeleteClassRelation,
    label: "Delete class relation",
    field: "has_delete_class_relation",
    section: "class_relation"
  },
  {
    value: PermissionValues.CreateObjectRelation,
    label: "Create object relation",
    field: "has_create_object_relation",
    section: "object_relation"
  },
  {
    value: PermissionValues.ReadObjectRelation,
    label: "Read object relation",
    field: "has_read_object_relation",
    section: "object_relation"
  },
  {
    value: PermissionValues.UpdateObjectRelation,
    label: "Update object relation",
    field: "has_update_object_relation",
    section: "object_relation"
  },
  {
    value: PermissionValues.DeleteObjectRelation,
    label: "Delete object relation",
    field: "has_delete_object_relation",
    section: "object_relation"
  }
];

async function fetchNamespace(namespaceId: number): Promise<Namespace> {
  const response = await getApiV1NamespacesByNamespaceId(namespaceId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespace."));
  }

  return response.data;
}

async function fetchGroups(): Promise<Group[]> {
  const response = await getApiV1IamGroups({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load groups."));
  }

  return response.data;
}

async function fetchNamespacePermissions(namespaceId: number): Promise<GroupPermission[]> {
  const response = await getApiV1NamespacesByNamespaceIdPermissions(namespaceId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespace permissions."));
  }

  return response.data;
}

async function putNamespacePermissions(namespaceId: number, groupId: number, permissions: PermissionName[]): Promise<void> {
  const response = await fetch(`/api/v1/namespaces/${namespaceId}/permissions/group/${groupId}`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(permissions)
  });

  if ([200, 201, 204].includes(response.status)) {
    return;
  }

  const rawPayload = await response.text();
  let payload: unknown = {};
  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload) as unknown;
    } catch {
      payload = { message: rawPayload };
    }
  }
  throw new Error(getApiErrorMessage(payload, "Failed to update namespace permissions."));
}

async function fetchCurrentUserGroups(username: string): Promise<Group[]> {
  try {
    const usersResponse = await getApiV1IamUsers({
      credentials: "include"
    });
    if (usersResponse.status !== 200) {
      return [];
    }

    const matchedUser = usersResponse.data.find((user) => user.username === username);
    if (!matchedUser) {
      return [];
    }

    const userGroupsResponse = await getApiV1IamUsersByUserIdGroups(matchedUser.id, {
      credentials: "include"
    });
    if (userGroupsResponse.status !== 200) {
      return [];
    }

    return userGroupsResponse.data;
  } catch {
    return [];
  }
}

function getEnabledPermissions(permissionRecord: Permission): PermissionName[] {
  return PERMISSION_DEFINITIONS.filter((definition) => isPermissionEnabled(permissionRecord, definition.field)).map(
    (definition) => definition.value
  );
}

type PermissionChip = {
  label: string;
  enabled: boolean;
};

function getPermissionChips(permissionRecord: Permission): PermissionChip[] {
  return PERMISSION_DEFINITIONS.map((definition) => ({
    label: definition.label,
    enabled: isPermissionEnabled(permissionRecord, definition.field)
  }));
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

function isPermissionEnabled(permissionRecord: Permission, field: PermissionFlagField): boolean {
  return normalizePermissionFlag(permissionRecord[field] as unknown);
}

function hasAllSubmittedPermissions(submitted: PermissionName[], persisted: PermissionName[]): boolean {
  const persistedSet = new Set(persisted);
  for (const permission of submitted) {
    if (!persistedSet.has(permission)) {
      return false;
    }
  }

  return true;
}

function arePermissionSetsEqual(left: PermissionName[], right: PermissionName[]): boolean {
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

export function NamespaceDetail({ namespaceId, currentUsername }: NamespaceDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [addingGroupPermissions, setAddingGroupPermissions] = useState(false);
  const [newPermissionGroupId, setNewPermissionGroupId] = useState("");
  const [newSelectedPermissions, setNewSelectedPermissions] = useState<PermissionName[]>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<number, PermissionName[]>>({});
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [permissionsSuccess, setPermissionsSuccess] = useState<string | null>(null);
  const [pendingRevokeGroupId, setPendingRevokeGroupId] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const namespaceQuery = useQuery({
    queryKey: ["namespace", namespaceId],
    queryFn: async () => fetchNamespace(namespaceId)
  });
  const groupsQuery = useQuery({
    queryKey: ["groups", "namespace-permissions", namespaceId],
    queryFn: fetchGroups
  });
  const permissionsQuery = useQuery({
    queryKey: ["namespace", namespaceId, "permissions"],
    queryFn: async () => fetchNamespacePermissions(namespaceId)
  });
  const currentUserGroupsQuery = useQuery({
    queryKey: ["permissions", "current-user-groups", currentUsername],
    queryFn: async () => {
      if (!currentUsername) {
        return [];
      }

      return fetchCurrentUserGroups(currentUsername);
    }
  });
  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateNamespace) => {
      const response = await patchApiV1NamespacesByNamespaceId(namespaceId, payload, {
        credentials: "include"
      });

      if (response.status !== 202) {
        throw new Error(getApiErrorMessage(response.data, "Failed to update namespace."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["namespace", namespaceId] });
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
      setFormError(null);
      setFormSuccess("Namespace updated.");
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to update namespace.");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await deleteApiV1NamespacesByNamespaceId(namespaceId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to delete namespace."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
      router.push("/namespaces");
      router.refresh();
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to delete namespace.");
    }
  });
  const upsertPermissionsMutation = useMutation({
    mutationFn: async (payload: {
      groupId: number;
      permissions: PermissionName[];
      mode: "create" | "edit";
    }) => {
      await putNamespacePermissions(namespaceId, payload.groupId, payload.permissions);

      const verificationResponse = await getApiV1NamespacesByNamespaceIdPermissionsGroupByGroupId(namespaceId, payload.groupId, {
        credentials: "include"
      });
      if (verificationResponse.status !== 200) {
        throw new Error(getApiErrorMessage(verificationResponse.data, "Permission update could not be verified."));
      }

      const persistedPermissions = getEnabledPermissions(verificationResponse.data);
      if (!hasAllSubmittedPermissions(payload.permissions, persistedPermissions)) {
        throw new Error("Permission update was accepted, but one or more submitted permissions are missing from the saved set.");
      }
    },
    onSuccess: async (_, payload) => {
      await queryClient.refetchQueries({ queryKey: ["namespace", namespaceId, "permissions"], exact: true, type: "active" });
      setPermissionsError(null);
      setPermissionsSuccess(payload.mode === "create" ? "Permissions granted." : "Permissions updated.");
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
      setPermissionsError(error instanceof Error ? error.message : "Failed to update namespace permissions.");
    }
  });
  const revokePermissionsMutation = useMutation({
    mutationFn: async (groupId: number) => {
      const response = await deleteApiV1NamespacesByNamespaceIdPermissionsGroupByGroupId(namespaceId, groupId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to revoke namespace permissions."));
      }
    },
    onMutate: (groupId) => {
      setPendingRevokeGroupId(groupId);
      setPermissionsError(null);
      setPermissionsSuccess(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["namespace", namespaceId, "permissions"] });
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
      setPermissionsError(error instanceof Error ? error.message : "Failed to revoke namespace permissions.");
    },
    onSettled: () => {
      setPendingRevokeGroupId(null);
    }
  });

  useEffect(() => {
    if (initialized || !namespaceQuery.data) {
      return;
    }

    setName(namespaceQuery.data.name);
    setDescription(namespaceQuery.data.description ?? "");
    setInitialized(true);
  }, [initialized, namespaceQuery.data]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    updateMutation.mutate({
      name: name.trim(),
      description: description.trim()
    });
  }

  function onDelete() {
    setFormError(null);
    setFormSuccess(null);
    if (!window.confirm(`Delete namespace #${namespaceId}?`)) {
      return;
    }

    deleteMutation.mutate();
  }

  function togglePermissionList(current: PermissionName[], permission: PermissionName, checked: boolean): PermissionName[] {
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

  function toggleRowPermission(entry: GroupPermission, permission: PermissionName, checked: boolean) {
    const basePermissions = getEnabledPermissions(entry.permission);
    setPermissionDrafts((current) => {
      const currentPermissions = current[entry.group.id] ?? basePermissions;
      const nextPermissions = togglePermissionList(currentPermissions, permission, checked);

      if (arePermissionSetsEqual(nextPermissions, basePermissions)) {
        const next = { ...current };
        delete next[entry.group.id];
        return next;
      }

      return {
        ...current,
        [entry.group.id]: nextPermissions
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
    const assignedGroupIds = new Set((permissionsQuery.data ?? []).map((entry) => entry.group.id));
    const availableGroups = groups.filter((group) => !assignedGroupIds.has(group.id));
    setNewPermissionGroupId(availableGroups.length > 0 ? String(availableGroups[0].id) : "");
  }

  function onSaveRowPermissions(entry: GroupPermission) {
    setPermissionsError(null);
    setPermissionsSuccess(null);

    const rowPermissions = permissionDrafts[entry.group.id] ?? getEnabledPermissions(entry.permission);
    if (rowPermissions.length === 0) {
      setPermissionsError("Select at least one permission, or use Revoke.");
      return;
    }

    upsertPermissionsMutation.mutate({
      groupId: entry.group.id,
      permissions: rowPermissions,
      mode: "edit"
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
      mode: "create"
    });
  }

  function renderPermissionEditor(
    selectedPermissionSet: Set<PermissionName>,
    onToggle: (permission: PermissionName, checked: boolean) => void
  ) {
    return (
      <div className="permission-chip-list permission-chip-list--editor">
        {PERMISSION_DEFINITIONS.map((definition) => {
          const enabled = selectedPermissionSet.has(definition.value);
          return (
            <button
              key={definition.value}
              type="button"
              className={`permission-chip permission-chip-button permission-chip--editor ${
                enabled ? "permission-chip--active" : "permission-chip--inactive"
              }`}
              onClick={() => onToggle(definition.value, !enabled)}
            >
              {definition.label}
            </button>
          );
        })}
      </div>
    );
  }

  function onRevokePermissions(groupId: number) {
    if (!window.confirm(`Revoke all namespace permissions for group #${groupId}?`)) {
      return;
    }

    revokePermissionsMutation.mutate(groupId);
  }

  const groups = groupsQuery.data ?? [];
  const permissionEntries = permissionsQuery.data ?? [];
  const assignedGroupIds = new Set(permissionEntries.map((entry) => entry.group.id));
  const availableGroups = groups.filter((group) => !assignedGroupIds.has(group.id));
  const usingGroupSelect = groups.length > 0 && !groupsQuery.isError;
  const currentUserGroupIds = new Set((currentUserGroupsQuery.data ?? []).map((group) => group.id));
  const canManagePermissions = permissionEntries.some(
    (entry) => isPermissionEnabled(entry.permission, "has_delegate_namespace") && currentUserGroupIds.has(entry.group.id)
  );
  const newSelectedPermissionSet = new Set(newSelectedPermissions);
  const sortedPermissionEntries = [...permissionEntries].sort((left, right) =>
    left.group.groupname.localeCompare(right.group.groupname)
  );
  const canCheckPermissionMembership = Boolean(currentUsername);
  const checkingPermissionMembership = canCheckPermissionMembership && (permissionsQuery.isLoading || currentUserGroupsQuery.isLoading);
  const hasAnyPermissionRows = sortedPermissionEntries.length > 0 || (canManagePermissions && addingGroupPermissions);
  const hasDirtyRowDrafts = Object.keys(permissionDrafts).length > 0;

  useEffect(() => {
    if (!addingGroupPermissions || !usingGroupSelect) {
      return;
    }

    if (availableGroups.length === 0) {
      setNewPermissionGroupId("");
      return;
    }

    const currentGroupStillAvailable = availableGroups.some((group) => String(group.id) === newPermissionGroupId);
    if (!currentGroupStillAvailable) {
      setNewPermissionGroupId(String(availableGroups[0].id));
    }
  }, [addingGroupPermissions, availableGroups, newPermissionGroupId, usingGroupSelect]);

  if (namespaceQuery.isLoading) {
    return <div className="card">Loading namespace...</div>;
  }

  if (namespaceQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load namespace. {namespaceQuery.error instanceof Error ? namespaceQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const namespaceData = namespaceQuery.data;
  if (!namespaceData) {
    return <div className="card error-banner">Namespace data is unavailable.</div>;
  }

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Namespace</p>
        <h2>
          {namespaceData.name} (#{namespaceData.id})
        </h2>
      </header>

      <form className="card stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Name</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="control-field control-field--wide">
            <span>Description</span>
            <input required value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions form-actions--spread">
          <button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save changes"}
          </button>
          <button type="button" className="danger" onClick={onDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting..." : "Delete namespace"}
          </button>
        </div>
      </form>

      <section className="card stack">
        <header className="stack">
          <h3>Namespace Permissions</h3>
          <p className="muted">
            {checkingPermissionMembership
              ? "Checking whether you can modify namespace permissions..."
              : canManagePermissions
                ? "You can grant, update, and revoke permission sets for groups on this namespace."
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
              {usingGroupSelect && availableGroups.length === 0 ? "All groups assigned" : "Add group permissions"}
            </button>
            {groupsQuery.isError ? (
              <span className="muted">Could not load groups automatically. You can enter a group ID manually.</span>
            ) : null}
          </div>
        ) : null}

        {permissionsError ? <div className="error-banner">{permissionsError}</div> : null}
        {permissionsSuccess ? <div className="muted">{permissionsSuccess}</div> : null}

        {permissionsQuery.isLoading ? (
          <div className="muted">Loading namespace permissions...</div>
        ) : permissionsQuery.isError ? (
          <div className="error-banner">
            Failed to load namespace permissions.{" "}
            {permissionsQuery.error instanceof Error ? permissionsQuery.error.message : "Unknown error"}
          </div>
        ) : !hasAnyPermissionRows ? (
          <div className="muted">No group permissions are currently assigned for this namespace.</div>
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
                            onChange={(event) => setNewPermissionGroupId(event.target.value)}
                            aria-label="Select group to grant permissions"
                          >
                            {availableGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.groupname} (#{group.id})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="muted">All groups already have permissions.</span>
                        )
                      ) : (
                        <input
                          type="number"
                          min={1}
                          value={newPermissionGroupId}
                          onChange={(event) => setNewPermissionGroupId(event.target.value)}
                          placeholder={groupsQuery.isLoading ? "Loading groups..." : "Enter group ID"}
                          disabled={groupsQuery.isLoading}
                          required
                        />
                      )}
                    </td>
                    <td>{renderPermissionEditor(newSelectedPermissionSet, toggleNewPermission)}</td>
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
                              (usingGroupSelect && availableGroups.length === 0)
                            }
                          >
                            {upsertPermissionsMutation.isPending ? "Saving..." : "Grant"}
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
                  const basePermissions = getEnabledPermissions(entry.permission);
                  const draftPermissions = permissionDrafts[entry.group.id] ?? basePermissions;
                  const draftPermissionSet = new Set(draftPermissions);
                  const isRowDirty = Object.hasOwn(permissionDrafts, entry.group.id);
                  const isSavingRow = upsertPermissionsMutation.isPending && isRowDirty;
                  const chips = getPermissionChips(entry.permission);
                  const isRevokePending =
                    revokePermissionsMutation.isPending && pendingRevokeGroupId !== null && pendingRevokeGroupId === entry.group.id;
                  const revokeDisabled =
                    isRevokePending || upsertPermissionsMutation.isPending || addingGroupPermissions || isRowDirty;
                  const actionDisabled = !isRowDirty || upsertPermissionsMutation.isPending || addingGroupPermissions;

                  return (
                    <tr key={entry.permission.id}>
                      <td>
                        {entry.group.groupname} (#{entry.group.id})
                      </td>
                      <td>
                        {canManagePermissions ? (
                          renderPermissionEditor(draftPermissionSet, (permission, checked) =>
                            toggleRowPermission(entry, permission, checked)
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
                      <td>{new Date(entry.permission.updated_at).toLocaleString()}</td>
                      {canManagePermissions ? (
                        <td>
                          <div className="table-tools permission-table-tools">
                            <div className="permission-action-stack">
                              <button type="button" className="ghost" onClick={() => onSaveRowPermissions(entry)} disabled={actionDisabled}>
                                {isSavingRow ? "Saving..." : isRowDirty ? "Save" : "Edit"}
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
                                  disabled={upsertPermissionsMutation.isPending}
                                >
                                  Cancel
                                </button>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => onRevokePermissions(entry.group.id)}
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
  );
}
