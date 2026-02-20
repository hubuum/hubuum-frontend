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
  patchApiV1NamespacesByNamespaceId,
  postApiV1NamespacesByNamespaceIdPermissionsGroupByGroupId
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
};

const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  { value: PermissionValues.ReadCollection, label: "Read namespace", field: "has_read_namespace" },
  { value: PermissionValues.UpdateCollection, label: "Update namespace", field: "has_update_namespace" },
  { value: PermissionValues.DeleteCollection, label: "Delete namespace", field: "has_delete_namespace" },
  { value: PermissionValues.DelegateCollection, label: "Delegate namespace", field: "has_delegate_namespace" },
  { value: PermissionValues.CreateClass, label: "Create class", field: "has_create_class" },
  { value: PermissionValues.ReadClass, label: "Read class", field: "has_read_class" },
  { value: PermissionValues.UpdateClass, label: "Update class", field: "has_update_class" },
  { value: PermissionValues.DeleteClass, label: "Delete class", field: "has_delete_class" },
  { value: PermissionValues.CreateObject, label: "Create object", field: "has_create_object" },
  { value: PermissionValues.ReadObject, label: "Read object", field: "has_read_object" },
  { value: PermissionValues.UpdateObject, label: "Update object", field: "has_update_object" },
  { value: PermissionValues.DeleteObject, label: "Delete object", field: "has_delete_object" },
  { value: PermissionValues.CreateClassRelation, label: "Create class relation", field: "has_create_class_relation" },
  { value: PermissionValues.ReadClassRelation, label: "Read class relation", field: "has_read_class_relation" },
  { value: PermissionValues.UpdateClassRelation, label: "Update class relation", field: "has_update_class_relation" },
  { value: PermissionValues.DeleteClassRelation, label: "Delete class relation", field: "has_delete_class_relation" },
  {
    value: PermissionValues.CreateObjectRelation,
    label: "Create object relation",
    field: "has_create_object_relation"
  },
  { value: PermissionValues.ReadObjectRelation, label: "Read object relation", field: "has_read_object_relation" },
  {
    value: PermissionValues.UpdateObjectRelation,
    label: "Update object relation",
    field: "has_update_object_relation"
  },
  {
    value: PermissionValues.DeleteObjectRelation,
    label: "Delete object relation",
    field: "has_delete_object_relation"
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
  return PERMISSION_DEFINITIONS.filter((definition) => permissionRecord[definition.field]).map((definition) => definition.value);
}

function formatPermissionLabels(permissionRecord: Permission): string[] {
  const active = new Set(getEnabledPermissions(permissionRecord));
  return PERMISSION_DEFINITIONS.filter((definition) => active.has(definition.value)).map((definition) => definition.label);
}

export function NamespaceDetail({ namespaceId, currentUsername }: NamespaceDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissionGroupId, setPermissionGroupId] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionName[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
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
    mutationFn: async (payload: { groupId: number; permissions: PermissionName[] }) => {
      const response = await postApiV1NamespacesByNamespaceIdPermissionsGroupByGroupId(
        namespaceId,
        payload.groupId,
        payload.permissions,
        {
          credentials: "include"
        }
      );

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(response.data, "Failed to update namespace permissions."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["namespace", namespaceId, "permissions"] });
      setPermissionsError(null);
      setPermissionsSuccess(editingGroupId === null ? "Permissions granted." : "Permissions updated.");
      setEditingGroupId(null);
      setSelectedPermissions([]);
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
      if (editingGroupId !== null && editingGroupId === pendingRevokeGroupId) {
        setEditingGroupId(null);
        setSelectedPermissions([]);
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

  useEffect(() => {
    const groups = groupsQuery.data ?? [];
    if (permissionGroupId || groups.length === 0) {
      return;
    }

    setPermissionGroupId(String(groups[0].id));
  }, [permissionGroupId, groupsQuery.data]);

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

  function togglePermission(permission: PermissionName, checked: boolean) {
    setSelectedPermissions((current) => {
      const currentSet = new Set(current);
      if (checked) {
        currentSet.add(permission);
      } else {
        currentSet.delete(permission);
      }

      return Array.from(currentSet);
    });
  }

  function onEditPermissionEntry(entry: GroupPermission) {
    setEditingGroupId(entry.group.id);
    setPermissionGroupId(String(entry.group.id));
    setSelectedPermissions(getEnabledPermissions(entry.permission));
    setPermissionsError(null);
    setPermissionsSuccess(null);
  }

  function onResetPermissionEditor() {
    setEditingGroupId(null);
    setSelectedPermissions([]);
    setPermissionsError(null);
    setPermissionsSuccess(null);
  }

  function onSubmitPermissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPermissionsError(null);
    setPermissionsSuccess(null);

    const parsedGroupId = Number.parseInt(permissionGroupId, 10);
    if (!Number.isFinite(parsedGroupId) || parsedGroupId < 1) {
      setPermissionsError("Group is required.");
      return;
    }

    if (selectedPermissions.length === 0) {
      setPermissionsError("Select at least one permission.");
      return;
    }

    upsertPermissionsMutation.mutate({
      groupId: parsedGroupId,
      permissions: selectedPermissions
    });
  }

  function onRevokePermissions(groupId: number) {
    if (!window.confirm(`Revoke all namespace permissions for group #${groupId}?`)) {
      return;
    }

    revokePermissionsMutation.mutate(groupId);
  }

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

  const groups = groupsQuery.data ?? [];
  const permissionEntries = permissionsQuery.data ?? [];
  const currentUserGroupIds = new Set((currentUserGroupsQuery.data ?? []).map((group) => group.id));
  const canManagePermissions = permissionEntries.some(
    (entry) => entry.permission.has_delegate_namespace && currentUserGroupIds.has(entry.group.id)
  );
  const selectedPermissionSet = new Set(selectedPermissions);
  const sortedPermissionEntries = [...permissionEntries].sort((left, right) =>
    left.group.groupname.localeCompare(right.group.groupname)
  );
  const canCheckPermissionMembership = Boolean(currentUsername);
  const checkingPermissionMembership = canCheckPermissionMembership && (permissionsQuery.isLoading || currentUserGroupsQuery.isLoading);

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
          <form className="stack" onSubmit={onSubmitPermissions}>
            <div className="form-grid">
              <div className="control-field">
                <label htmlFor="namespace-permissions-group">Group</label>
                {groups.length > 0 ? (
                  <select
                    id="namespace-permissions-group"
                    value={permissionGroupId}
                    onChange={(event) => setPermissionGroupId(event.target.value)}
                    required
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.groupname} (#{group.id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="namespace-permissions-group"
                    type="number"
                    min={1}
                    value={permissionGroupId}
                    onChange={(event) => setPermissionGroupId(event.target.value)}
                    placeholder={groupsQuery.isLoading ? "Loading groups..." : "Enter group ID"}
                    disabled={groupsQuery.isLoading}
                    required
                  />
                )}
              </div>

              <div className="control-field control-field--wide">
                <span>Permission set</span>
                <div className="permissions-grid">
                  {PERMISSION_DEFINITIONS.map((definition) => (
                    <label key={definition.value} className="control-check permission-check">
                      <input
                        type="checkbox"
                        checked={selectedPermissionSet.has(definition.value)}
                        onChange={(event) => togglePermission(definition.value, event.target.checked)}
                      />
                      <span>{definition.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {permissionsError ? <div className="error-banner">{permissionsError}</div> : null}
            {permissionsSuccess ? <div className="muted">{permissionsSuccess}</div> : null}
            {groupsQuery.isError ? (
              <div className="muted">Could not load groups automatically. Manual group ID entry is enabled.</div>
            ) : null}

            <div className="form-actions">
              <button type="submit" disabled={upsertPermissionsMutation.isPending}>
                {upsertPermissionsMutation.isPending
                  ? "Saving permissions..."
                  : editingGroupId === null
                    ? "Grant permissions"
                    : "Save permission set"}
              </button>
              {editingGroupId !== null ? (
                <button type="button" className="ghost" onClick={onResetPermissionEditor} disabled={upsertPermissionsMutation.isPending}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        {permissionsQuery.isLoading ? (
          <div className="muted">Loading namespace permissions...</div>
        ) : permissionsQuery.isError ? (
          <div className="error-banner">
            Failed to load namespace permissions.{" "}
            {permissionsQuery.error instanceof Error ? permissionsQuery.error.message : "Unknown error"}
          </div>
        ) : sortedPermissionEntries.length === 0 ? (
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
                {sortedPermissionEntries.map((entry) => {
                  const labels = formatPermissionLabels(entry.permission);
                  const isRevokePending =
                    revokePermissionsMutation.isPending && pendingRevokeGroupId !== null && pendingRevokeGroupId === entry.group.id;

                  return (
                    <tr key={entry.permission.id}>
                      <td>
                        {entry.group.groupname} (#{entry.group.id})
                      </td>
                      <td>
                        {labels.length > 0 ? (
                          <div className="permission-chip-list">
                            {labels.map((label) => (
                              <span key={label} className="permission-chip">
                                {label}
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
                          <div className="table-tools">
                            <button type="button" className="ghost" onClick={() => onEditPermissionEntry(entry)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => onRevokePermissions(entry.group.id)}
                              disabled={isRevokePending}
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
