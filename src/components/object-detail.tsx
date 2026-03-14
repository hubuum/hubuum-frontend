"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteApiV1ClassesByClassIdByObjectId,
  getApiV1Classes,
  getApiV1ClassesByClassIdByObjectId,
  getApiV1IamUsers,
  getApiV1IamUsersByUserIdGroups,
  getApiV1Namespaces,
  getApiV1NamespacesByNamespaceIdPermissions,
  patchApiV1ClassesByClassIdByObjectId
} from "@/lib/api/generated/client";
import { JsonEditor } from "@/components/json-editor";
import { JsonViewer } from "@/components/json-viewer";
import type {
  Group,
  GroupPermission,
  HubuumClassExpanded,
  HubuumObject,
  HubuumObjectWithPath,
  Namespace,
  UpdateHubuumObject
} from "@/lib/api/generated/models";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";

type ObjectDetailProps = {
  classId: number;
  objectId: number;
  currentUsername: string | null;
  canEditAnything: boolean;
};

type EditableField = "name" | "description" | "namespace" | "data";

async function fetchObject(classId: number, objectId: number): Promise<HubuumObject> {
  const response = await getApiV1ClassesByClassIdByObjectId(classId, objectId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load object."));
  }

  return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
  const response = await getApiV1Classes(undefined, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
  }

  return response.data;
}

async function fetchNamespaces(): Promise<Namespace[]> {
  const response = await getApiV1Namespaces(undefined, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespaces."));
  }

  return response.data;
}

async function fetchNamespacePermissions(namespaceId: number): Promise<GroupPermission[]> {
  const response = await getApiV1NamespacesByNamespaceIdPermissions(namespaceId, undefined, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespace permissions."));
  }

  return response.data;
}

async function fetchCurrentUserGroups(username: string): Promise<Group[]> {
  try {
    const usersResponse = await getApiV1IamUsers(undefined, {
      credentials: "include"
    });
    if (usersResponse.status !== 200) {
      return [];
    }

    const matchedUser = usersResponse.data.find((user) => user.username === username);
    if (!matchedUser) {
      return [];
    }

    const userGroupsResponse = await getApiV1IamUsersByUserIdGroups(matchedUser.id, undefined, {
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
  ignoredClassIds: number[]
): Promise<HubuumObjectWithPath[]> {
  const params = new URLSearchParams({
    limit: "250",
    sort: "path.asc,id.asc",
    depth__lte: String(depthLimit),
    ignore_self_class: String(!includeSelfClass)
  });
  if (ignoredClassIds.length) {
    params.set("ignore_classes", ignoredClassIds.join(","));
  }
  const response = await fetch(`/api/v1/classes/${classId}/objects/${objectId}/related/objects?${params.toString()}`, {
    credentials: "include"
  });
  const payload = await parseJsonPayload(response);
  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(payload, "Failed to load related objects."));
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

function canCurrentUserUpdateObject(permissionEntries: GroupPermission[], currentUserGroups: Group[]): boolean {
  const currentUserGroupIds = new Set(currentUserGroups.map((group) => group.id));
  return permissionEntries.some(
    (entry) => currentUserGroupIds.has(entry.group.id) && normalizePermissionFlag(entry.permission.has_update_object)
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

export function ObjectDetail({ classId, objectId, currentUsername, canEditAnything }: ObjectDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ignoreClassesRef = useRef<HTMLDivElement | null>(null);

  const [relationDepthLimit, setRelationDepthLimit] = useState(2);
  const [includeSelfClass, setIncludeSelfClass] = useState(false);
  const [ignoredClassIds, setIgnoredClassIds] = useState<number[]>([]);
  const [isIgnoreClassesOpen, setIgnoreClassesOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataInput, setDataInput] = useState("{}");
  const [namespaceId, setNamespaceId] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [editingFields, setEditingFields] = useState<EditableField[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const objectQuery = useQuery({
    queryKey: ["object", classId, objectId],
    queryFn: async () => fetchObject(classId, objectId)
  });
  const classesQuery = useQuery({
    queryKey: ["classes", "object-detail"],
    queryFn: fetchClasses
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", "object-detail"],
    queryFn: fetchNamespaces
  });
  const namespacePermissionsQuery = useQuery({
    queryKey: ["namespace", objectQuery.data?.namespace_id, "permissions", "object-detail"],
    queryFn: async () => {
      if (!objectQuery.data) {
        return [];
      }

      return fetchNamespacePermissions(objectQuery.data.namespace_id);
    },
    enabled: Boolean(objectQuery.data) && !canEditAnything
  });
  const currentUserGroupsQuery = useQuery({
    queryKey: ["permissions", "current-user-groups", currentUsername, "object-detail"],
    queryFn: async () => {
      if (!currentUsername) {
        return [];
      }

      return fetchCurrentUserGroups(currentUsername);
    },
    enabled: Boolean(currentUsername) && !canEditAnything
  });
  const relatedObjectsQuery = useQuery({
    queryKey: [
      "object-related-objects",
      "detail",
      classId,
      objectId,
      relationDepthLimit,
      includeSelfClass,
      ignoredClassIds
    ],
    queryFn: async () => fetchRelatedObjects(classId, objectId, relationDepthLimit, includeSelfClass, ignoredClassIds)
  });

  useEffect(() => {
    if (!objectQuery.data) {
      return;
    }

    if (!initialized || editingFields.length === 0) {
      setName(objectQuery.data.name);
      setDescription(objectQuery.data.description ?? "");
      setDataInput(stringifyJson(objectQuery.data.data));
      setNamespaceId(String(objectQuery.data.namespace_id));
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

  const namespaces = namespacesQuery.data ?? [];

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateHubuumObject) => {
      const response = await patchApiV1ClassesByClassIdByObjectId(classId, objectId, payload, {
        credentials: "include"
      });

      if (response.status !== 200) {
        throw new Error(getApiErrorMessage(response.data, "Failed to update object."));
      }

      return response.data;
    },
    onSuccess: async (updatedObject) => {
      const targetClassId = updatedObject.hubuum_class_id;
      await queryClient.invalidateQueries({ queryKey: ["object", classId, objectId] });
      await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
      await queryClient.invalidateQueries({ queryKey: ["objects", targetClassId] });
      await queryClient.invalidateQueries({ queryKey: ["namespace", updatedObject.namespace_id, "permissions"] });
      setName(updatedObject.name);
      setDescription(updatedObject.description ?? "");
      setDataInput(stringifyJson(updatedObject.data));
      setNamespaceId(String(updatedObject.namespace_id));
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
      setFormError(error instanceof Error ? error.message : "Failed to update object.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await deleteApiV1ClassesByClassIdByObjectId(classId, objectId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to delete object."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
      router.push("/objects");
      router.refresh();
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to delete object.");
    }
  });

  function resetFieldDraft(field: EditableField, objectData: HubuumObject) {
    if (field === "name") {
      setName(objectData.name);
      return;
    }

    if (field === "description") {
      setDescription(objectData.description ?? "");
      return;
    }

    if (field === "namespace") {
      setNamespaceId(String(objectData.namespace_id));
      return;
    }

    setDataInput(stringifyJson(objectData.data));
  }

  function toggleFieldEditing(field: EditableField, objectData: HubuumObject) {
    setFormError(null);
    setFormSuccess(null);

    if (editingFields.includes(field)) {
      resetFieldDraft(field, objectData);
      setEditingFields((current) => current.filter((currentField) => currentField !== field));
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

    const parsedNamespaceId = Number.parseInt(namespaceId, 10);
    if (!Number.isFinite(parsedNamespaceId) || parsedNamespaceId < 1) {
      setFormError("Namespace ID is required.");
      return;
    }

    const payload: UpdateHubuumObject = {
      name: name.trim(),
      description: description.trim(),
      data: parsedData,
      hubuum_class_id: classId,
      namespace_id: parsedNamespaceId
    };

    updateMutation.mutate(payload);
  }

  function onDelete() {
    setFormError(null);
    setFormSuccess(null);
    if (!window.confirm(`Delete object #${objectId}?`)) {
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
        Failed to load object. {objectQuery.error instanceof Error ? objectQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const objectData = objectQuery.data;
  if (!objectData) {
    return <div className="card error-banner">Object data is unavailable.</div>;
  }

  const currentClass = (classesQuery.data ?? []).find((item) => item.id === objectData.hubuum_class_id) ?? null;
  const className = currentClass?.name ?? null;
  const hasNamespaceOptions = namespaces.length > 0;
  const hasNamespaceSelection = namespaces.some((namespace) => String(namespace.id) === namespaceId);
  const classNameById = new Map<number, string>();
  for (const item of classesQuery.data ?? []) {
    classNameById.set(item.id, item.name);
  }
  const namespaceNameById = new Map<number, string>();
  for (const namespace of namespaces) {
    namespaceNameById.set(namespace.id, namespace.name);
  }
  const objectContextById = new Map<number, { classId: number; name: string }>();
  objectContextById.set(objectData.id, {
    classId: objectData.hubuum_class_id,
    name: objectData.name
  });
  for (const relatedObject of relatedObjectsQuery.data ?? []) {
    objectContextById.set(relatedObject.id, {
      classId: relatedObject.hubuum_class_id,
      name: relatedObject.name
    });
  }
  const relatedObjects = [...(relatedObjectsQuery.data ?? [])].sort((left, right) => {
    const depthDelta = left.path.length - right.path.length;
    if (depthDelta !== 0) {
      return depthDelta;
    }

    return left.name.localeCompare(right.name);
  });
  const ignoredClassSet = new Set(ignoredClassIds);
  const ignoredClassOptions = (classesQuery.data ?? [])
    .filter((item) => item.id !== objectData.hubuum_class_id)
    .sort((left, right) => left.name.localeCompare(right.name));
  const currentUserGroups = currentUserGroupsQuery.data ?? [];
  const permissionEntries = namespacePermissionsQuery.data ?? [];
  const canCheckPermissionMembership = Boolean(currentUsername);
  const permissionCheckPending =
    !canEditAnything && canCheckPermissionMembership && (namespacePermissionsQuery.isLoading || currentUserGroupsQuery.isLoading);
  const canEditObject =
    canEditAnything || (canCheckPermissionMembership && canCurrentUserUpdateObject(permissionEntries, currentUserGroups));
  const hasActiveEdits = editingFields.length > 0;
  const isSavingOrDeleting = updateMutation.isPending || deleteMutation.isPending;
  const namespaceLabel =
    namespaceNameById.get(objectData.namespace_id) ?? `Namespace #${objectData.namespace_id}`;
  const editAccessMessage = canEditAnything
    ? "Admin access lets you edit this object regardless of namespace-level UpdateObject grants."
    : permissionCheckPending
      ? "Checking whether you can update this object..."
      : canEditObject
        ? "Toggle edit only on the fields you want to change."
        : canCheckPermissionMembership
          ? "You can view this object, but editing is unavailable because your access does not include UpdateObject on this namespace."
          : "Could not identify the current user. Showing a read-only object view.";

  function renderObjectLabel(relatedObjectId: number) {
    const relatedObject = objectContextById.get(relatedObjectId);
    if (!relatedObject) {
      return `Unknown related object (#${relatedObjectId})`;
    }

    const relatedClassName = classNameById.get(relatedObject.classId);
    return relatedClassName ? `${relatedClassName} / ${relatedObject.name}` : relatedObject.name;
  }

  function getDisplayPath(path: number[], targetId: number): number[] {
    const normalizedPath = path.length ? [...path] : [targetId];
    const trimmedPath = normalizedPath[0] === objectId ? normalizedPath.slice(1) : normalizedPath;
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
      <Link href={`/objects/${pathObject.classId}/${objectPathId}`}>{label}</Link>
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
    const groups = new Map<number, { rootPath: number[]; children: number[][] }>();
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
          children: displayPath.length > 1 ? [displayPath.slice(1)] : []
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
              : classNameById.get(objectContextById.get(leftFirstHop)?.classId ?? -1) ?? "";
          const rightClassName =
            rightFirstHop === undefined
              ? ""
              : classNameById.get(objectContextById.get(rightFirstHop)?.classId ?? -1) ?? "";
          const classCompare = leftClassName.localeCompare(rightClassName);
          if (classCompare !== 0) {
            return classCompare;
          }

          const leftLabel = left.map((objectPathId) => renderObjectLabel(objectPathId)).join(" -> ");
          const rightLabel = right.map((objectPathId) => renderObjectLabel(objectPathId)).join(" -> ");
          return leftLabel.localeCompare(rightLabel);
        })
      }))
      .sort((left, right) => left.rootLabel.localeCompare(right.rootLabel));
  })();

  function toggleIgnoredClass(classToToggle: number, checked: boolean) {
    setIgnoredClassIds((current) => {
      if (checked) {
        return current.includes(classToToggle) ? current : [...current, classToToggle].sort((left, right) => left - right);
      }

      return current.filter((classIdValue) => classIdValue !== classToToggle);
    });
  }

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Object</p>
        <h2>
          {objectData.name} (#{objectData.id})
        </h2>
      </header>

      <form className="card stack" onSubmit={onSubmit}>
        <div className="object-meta-strip">
          <div className="object-meta-item">
            <span className="object-meta-label">Class</span>
            <span className="object-meta-value">{className ?? `Class #${objectData.hubuum_class_id}`}</span>
          </div>
          <div className="object-meta-item">
            <span className="object-meta-label">Namespace</span>
            <span className="object-meta-value">
              {namespaceLabel} <span className="muted">#{objectData.namespace_id}</span>
            </span>
          </div>
          <div className="object-meta-item">
            <span className="object-meta-label">Created</span>
            <span className="object-meta-value">{formatTimestamp(objectData.created_at)}</span>
          </div>
          <div className="object-meta-item">
            <span className="object-meta-label">Updated</span>
            <span className="object-meta-value">{formatTimestamp(objectData.updated_at)}</span>
          </div>
        </div>

        <div className="muted">{editAccessMessage}</div>

        <div className="object-detail-list">
          <section className={`object-detail-row${editingFields.includes("name") ? " is-editing" : ""}`}>
            <div className="object-detail-label">Name</div>
            <div className="object-detail-body">
              {editingFields.includes("name") ? (
                <label className="control-field">
                  <span className="sr-only">Object name</span>
                  <input required value={name} onChange={(event) => setName(event.target.value)} />
                </label>
              ) : canEditObject ? (
                <button
                  type="button"
                  className="object-inline-edit"
                  onClick={() => toggleFieldEditing("name", objectData)}
                  disabled={isSavingOrDeleting}
                >
                  <span className="object-detail-value">{renderFieldText(objectData.name)}</span>
                  <span className="object-inline-edit-icon">
                    <InlineEditIcon />
                  </span>
                </button>
              ) : (
                <div className="object-detail-value">{renderFieldText(objectData.name)}</div>
              )}
            </div>
            <div className="object-detail-row-actions">
              {canEditObject && editingFields.includes("name") ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => toggleFieldEditing("name", objectData)}
                  disabled={isSavingOrDeleting}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </section>

          <section className={`object-detail-row${editingFields.includes("description") ? " is-editing" : ""}`}>
            <div className="object-detail-label">Description</div>
            <div className="object-detail-body">
              {editingFields.includes("description") ? (
                <label className="control-field">
                  <span className="sr-only">Object description</span>
                  <input required value={description} onChange={(event) => setDescription(event.target.value)} />
                </label>
              ) : canEditObject ? (
                <button
                  type="button"
                  className="object-inline-edit"
                  onClick={() => toggleFieldEditing("description", objectData)}
                  disabled={isSavingOrDeleting}
                >
                  <span className="object-detail-value">{renderFieldText(objectData.description ?? "")}</span>
                  <span className="object-inline-edit-icon">
                    <InlineEditIcon />
                  </span>
                </button>
              ) : (
                <div className="object-detail-value">{renderFieldText(objectData.description ?? "")}</div>
              )}
            </div>
            <div className="object-detail-row-actions">
              {canEditObject && editingFields.includes("description") ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => toggleFieldEditing("description", objectData)}
                  disabled={isSavingOrDeleting}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </section>

          <section className={`object-detail-row${editingFields.includes("namespace") ? " is-editing" : ""}`}>
            <div className="object-detail-label">Namespace</div>
            <div className="object-detail-body">
              {editingFields.includes("namespace") ? (
                <div className="control-field">
                  <label htmlFor="object-detail-namespace" className="sr-only">
                    Namespace
                  </label>
                  {hasNamespaceOptions ? (
                    <select
                      id="object-detail-namespace"
                      required
                      value={hasNamespaceSelection ? namespaceId : ""}
                      onChange={(event) => setNamespaceId(event.target.value)}
                    >
                      {!hasNamespaceSelection ? <option value="">Select a namespace...</option> : null}
                      {namespaces.map((namespace) => (
                        <option key={namespace.id} value={namespace.id}>
                          {namespace.name} (#{namespace.id})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="object-detail-namespace"
                      required
                      type="number"
                      min={1}
                      value={namespaceId}
                      onChange={(event) => setNamespaceId(event.target.value)}
                      placeholder={namespacesQuery.isLoading ? "Loading namespaces..." : "Enter namespace ID"}
                      disabled={namespacesQuery.isLoading}
                    />
                  )}
                </div>
              ) : canEditObject ? (
                <button
                  type="button"
                  className="object-inline-edit"
                  onClick={() => toggleFieldEditing("namespace", objectData)}
                  disabled={isSavingOrDeleting}
                >
                  <span className="object-detail-value">
                    {namespaceLabel} <span className="muted">#{objectData.namespace_id}</span>
                  </span>
                  <span className="object-inline-edit-icon">
                    <InlineEditIcon />
                  </span>
                </button>
              ) : (
                <div className="object-detail-value">
                  {namespaceLabel} <span className="muted">#{objectData.namespace_id}</span>
                </div>
              )}
            </div>
            <div className="object-detail-row-actions">
              {canEditObject && editingFields.includes("namespace") ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => toggleFieldEditing("namespace", objectData)}
                  disabled={isSavingOrDeleting}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </section>

          <section className={`object-detail-row object-detail-row--data${editingFields.includes("data") ? " is-editing" : ""}`}>
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
              {canEditObject ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => toggleFieldEditing("data", objectData)}
                  disabled={isSavingOrDeleting}
                >
                  {editingFields.includes("data") ? "Cancel" : "Edit"}
                </button>
              ) : null}
            </div>
          </section>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {classesQuery.isError ? <div className="muted">Could not load class names. Showing class ID only.</div> : null}
        {namespacesQuery.isError ? (
          <div className="muted">Could not load namespaces automatically. Manual namespace ID entry is enabled.</div>
        ) : null}
        {namespacePermissionsQuery.isError ? (
          <div className="muted">Could not verify namespace update permissions. Editing is hidden until that check succeeds.</div>
        ) : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions form-actions--spread">
          {canEditObject ? (
            hasActiveEdits ? (
              <button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save changes"}
              </button>
            ) : (
              <div className="muted">Toggle edit on for a field to make changes.</div>
            )
          ) : (
            <div className="muted">This object is currently read-only.</div>
          )}
          <button type="button" className="danger" onClick={onDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting..." : "Delete object"}
          </button>
        </div>
      </form>

      <section className="card stack">
        {relatedObjectsQuery.isLoading ? <div className="muted">Loading object relations...</div> : null}
        {relatedObjectsQuery.isError ? (
          <div className="error-banner">
            Failed to load object relations.{" "}
            {relatedObjectsQuery.error instanceof Error ? relatedObjectsQuery.error.message : "Unknown error"}
          </div>
        ) : null}
        {!relatedObjectsQuery.isLoading && !relatedObjectsQuery.isError ? (
          <>
            <div className="relations-toolbar">
              <div className="relations-toolbar-meta">
                <h3 className="relations-title">Relations: {relatedObjects.length}</h3>
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
                        setRelationDepthLimit(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
                      }}
                      aria-label="Relationship depth"
                    />
                  </div>
                </div>
                <label className="relations-toggle">
                  <input
                    type="checkbox"
                    checked={includeSelfClass}
                    onChange={(event) => setIncludeSelfClass(event.target.checked)}
                  />
                  <span>Include self class</span>
                </label>
                <div className="relations-filter-dropdown" ref={ignoreClassesRef}>
                  <button
                    type="button"
                    className="ghost relations-filter-trigger"
                    onClick={() => setIgnoreClassesOpen((current) => !current)}
                    aria-haspopup="menu"
                    aria-expanded={isIgnoreClassesOpen}
                  >
                    Ignore classes
                    {ignoredClassIds.length ? ` (${ignoredClassIds.length})` : ""}
                  </button>
                  {isIgnoreClassesOpen ? (
                    <div className="relations-filter-menu" role="menu">
                      {ignoredClassOptions.length ? (
                        ignoredClassOptions.map((hubuumClass) => (
                          <label key={hubuumClass.id} className="relations-filter-option">
                            <input
                              type="checkbox"
                              checked={ignoredClassSet.has(hubuumClass.id)}
                              onChange={(event) => toggleIgnoredClass(hubuumClass.id, event.target.checked)}
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
              <div className="empty-state">No related objects for this object yet.</div>
            ) : (
              <ul className="stat-list compact-stat-list relations-path-list">
                {relatedObjectGroups.map((group) => (
                  <li key={group.rootId}>
                    <div>{renderObjectPath(group.rootPath, `root-${group.rootId}`)}</div>
                    {group.children.map((childPath) => (
                      <div key={`child-${group.rootId}-${childPath.join("-")}`} className="relations-child-path">
                        <span className="muted">{"\u2192 "}</span>
                        {renderObjectPath(childPath, `child-${group.rootId}`)}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {relatedObjectsQuery.isError ? (
              <div className="muted">Could not resolve all related objects automatically. Showing IDs instead.</div>
            ) : null}
            {classesQuery.isError ? <div className="muted">Could not load class names. Showing class IDs instead.</div> : null}
          </>
        ) : null}
      </section>
    </section>
  );
}
