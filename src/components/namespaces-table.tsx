"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";

import {
  deleteApiV1NamespacesByNamespaceId,
  getApiV1IamGroups,
  getApiV1Namespaces,
  postApiV1Namespaces
} from "@/lib/api/generated/client";
import type { Group, Namespace, NewNamespaceWithAssignee } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

async function fetchNamespaces(): Promise<Namespace[]> {
  const response = await getApiV1Namespaces({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespaces."));
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

export function NamespacesTable() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [selectedNamespaceIds, setSelectedNamespaceIds] = useState<number[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableSuccess, setTableSuccess] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["namespaces"],
    queryFn: fetchNamespaces
  });
  const groupsQuery = useQuery({
    queryKey: ["groups", "namespace-form"],
    queryFn: fetchGroups
  });
  const createMutation = useMutation({
    mutationFn: async (payload: NewNamespaceWithAssignee) => {
      const response = await postApiV1Namespaces(payload, {
        credentials: "include"
      });

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(response.data, "Failed to create namespace."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
      setName("");
      setDescription("");
      if (groupsQuery.data?.length) {
        setGroupId(String(groupsQuery.data[0].id));
      }
      setFormError(null);
      setFormSuccess("Namespace created.");
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to create namespace.");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: async (namespaceIds: number[]) => {
      const results = await Promise.all(
        namespaceIds.map(async (namespaceId) => {
          const response = await deleteApiV1NamespacesByNamespaceId(namespaceId, {
            credentials: "include"
          });

          if (response.status !== 204) {
            throw new Error(`#${namespaceId}: ${getApiErrorMessage(response.data, "Failed to delete namespace.")}`);
          }
        })
      );
      return results.length;
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
      await queryClient.invalidateQueries({ queryKey: ["namespaces", "class-form"] });
      setSelectedNamespaceIds([]);
      setTableError(null);
      setTableSuccess(`${count} namespace${count === 1 ? "" : "s"} deleted.`);
    },
    onError: (error) => {
      setTableSuccess(null);
      setTableError(error instanceof Error ? error.message : "Failed to delete selected namespaces.");
    }
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const parsedGroupId = Number.parseInt(groupId, 10);
    if (!Number.isFinite(parsedGroupId) || parsedGroupId < 1) {
      setFormError("Group ID must be a positive integer.");
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      group_id: parsedGroupId
    });
  }

  const groups = groupsQuery.data ?? [];
  const namespaces = query.data ?? [];
  const allSelected = namespaces.length > 0 && selectedNamespaceIds.length === namespaces.length;

  useEffect(() => {
    if (groupId || groups.length === 0) {
      return;
    }

    setGroupId(String(groups[0].id));
  }, [groupId, groups]);

  useEffect(() => {
    if (!selectedNamespaceIds.length) {
      return;
    }

    const existingIds = new Set(namespaces.map((namespace) => namespace.id));
    setSelectedNamespaceIds((current) => current.filter((namespaceId) => existingIds.has(namespaceId)));
  }, [namespaces, selectedNamespaceIds.length]);

  if (query.isLoading) {
    return <div className="card">Loading namespaces...</div>;
  }

  if (query.isError) {
    return (
      <div className="card error-banner">
        Failed to load namespaces. {query.error instanceof Error ? query.error.message : "Unknown error"}
      </div>
    );
  }

  function toggleAllNamespaces(checked: boolean) {
    if (checked) {
      setSelectedNamespaceIds(namespaces.map((namespace) => namespace.id));
      return;
    }

    setSelectedNamespaceIds([]);
  }

  function toggleNamespace(namespaceId: number, checked: boolean) {
    setSelectedNamespaceIds((current) => {
      if (checked) {
        return current.includes(namespaceId) ? current : [...current, namespaceId];
      }
      return current.filter((id) => id !== namespaceId);
    });
  }

  function deleteSelectedNamespaces() {
    if (!selectedNamespaceIds.length) {
      return;
    }

    setTableError(null);
    setTableSuccess(null);

    const confirmed = window.confirm(`Delete ${selectedNamespaceIds.length} selected namespace(s)?`);
    if (!confirmed) {
      return;
    }

    deleteMutation.mutate([...selectedNamespaceIds]);
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={onSubmit}>
        <div className="table-header">
          <h3>Create namespace</h3>
        </div>

        <div className="form-grid">
          <label className="control-field">
            <span>Name</span>
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. infra"
            />
          </label>

          <div className="control-field">
            <span>Assignee group</span>
            {groups.length > 0 ? (
              <select required value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.groupname} (#{group.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                type="number"
                min={1}
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                placeholder={groupsQuery.isLoading ? "Loading groups..." : "Enter group id"}
                disabled={groupsQuery.isLoading}
              />
            )}
          </div>

          <label className="control-field control-field--wide">
            <span>Description</span>
            <input
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Namespace purpose"
            />
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {groupsQuery.isError ? (
          <div className="muted">
            Could not load groups automatically. Falling back to manual group ID entry.
          </div>
        ) : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create namespace"}
          </button>
        </div>
      </form>

      <div className="card table-wrap">
        <div className="table-header">
          <h3>Namespace catalog</h3>
          <div className="table-tools">
            <span className="muted">
              {namespaces.length} loaded
              {selectedNamespaceIds.length ? ` • ${selectedNamespaceIds.length} selected` : ""}
            </span>
            <button
              type="button"
              className="danger"
              onClick={deleteSelectedNamespaces}
              disabled={deleteMutation.isPending || selectedNamespaceIds.length === 0}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete selected"}
            </button>
          </div>
        </div>
        {tableError ? <div className="error-banner">{tableError}</div> : null}
        {tableSuccess ? <div className="muted">{tableSuccess}</div> : null}

        <table>
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  aria-label="Select all namespaces"
                  checked={allSelected}
                  onChange={(event) => toggleAllNamespaces(event.target.checked)}
                />
              </th>
              <th>ID</th>
              <th>Name</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {namespaces.map((namespace) => (
              <tr key={namespace.id}>
                <td className="check-col">
                  <input
                    type="checkbox"
                    aria-label={`Select namespace ${namespace.name}`}
                    checked={selectedNamespaceIds.includes(namespace.id)}
                    onChange={(event) => toggleNamespace(namespace.id, event.target.checked)}
                  />
                </td>
                <td>{namespace.id}</td>
                <td>
                  <Link href={`/namespaces/${namespace.id}`} className="row-link">
                    {namespace.name}
                  </Link>
                </td>
                <td>{namespace.description || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
