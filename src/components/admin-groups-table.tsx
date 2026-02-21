"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import {
  deleteApiV1IamGroupsByGroupId,
  getApiV1IamGroups,
  getApiV1IamGroupsByGroupIdMembers,
  postApiV1IamGroups
} from "@/lib/api/generated/client";
import { CreateModal } from "@/components/create-modal";
import type { Group, NewGroup } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";
import { OPEN_CREATE_EVENT, type OpenCreateEventDetail } from "@/lib/create-events";

async function fetchGroups(): Promise<Group[]> {
  const response = await getApiV1IamGroups({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load groups."));
  }

  return response.data;
}

async function fetchGroupMemberCount(groupId: number): Promise<number> {
  const response = await getApiV1IamGroupsByGroupIdMembers(groupId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, `Failed to load members for group #${groupId}.`));
  }

  return response.data.length;
}

export function AdminGroupsTable() {
  const queryClient = useQueryClient();
  const [groupname, setGroupname] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableSuccess, setTableSuccess] = useState<string | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const query = useQuery({
    queryKey: ["admin-groups"],
    queryFn: fetchGroups
  });
  const groups = query.data ?? [];
  const groupIdsKey = groups.map((group) => group.id).join(",");
  const memberCountsQuery = useQuery({
    queryKey: ["admin-group-member-counts", groupIdsKey],
    queryFn: async () => {
      const counts = await Promise.all(
        groups.map(async (group) => {
          const count = await fetchGroupMemberCount(group.id);
          return [group.id, count] as const;
        })
      );
      return Object.fromEntries(counts) as Record<number, number>;
    },
    enabled: groups.length > 0
  });
  const createMutation = useMutation({
    mutationFn: async (payload: NewGroup) => {
      const response = await postApiV1IamGroups(payload, {
        credentials: "include"
      });

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(response.data, "Failed to create group."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-group-member-counts"] });
      setGroupname("");
      setDescription("");
      setFormError(null);
      setTableError(null);
      setFormSuccess("Group created.");
      setTableSuccess("Group created.");
      setCreateModalOpen(false);
    },
    onError: (error) => {
      setFormSuccess(null);
      setTableSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to create group.");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: async (groupIds: number[]) => {
      const results = await Promise.all(
        groupIds.map(async (groupId) => {
          const response = await deleteApiV1IamGroupsByGroupId(groupId, {
            credentials: "include"
          });

          if (response.status !== 204) {
            throw new Error(`#${groupId}: ${getApiErrorMessage(response.data, "Failed to delete group.")}`);
          }
        })
      );
      return results.length;
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-group-member-counts"] });
      setSelectedGroupIds([]);
      setTableError(null);
      setTableSuccess(`${count} group${count === 1 ? "" : "s"} deleted.`);
    },
    onError: (error) => {
      setTableSuccess(null);
      setTableError(error instanceof Error ? error.message : "Failed to delete selected groups.");
    }
  });
  useEffect(() => {
    const onOpenCreate = (event: Event) => {
      const customEvent = event as CustomEvent<OpenCreateEventDetail>;
      if (customEvent.detail?.section !== "admin-groups") {
        return;
      }

      setFormError(null);
      setFormSuccess(null);
      setCreateModalOpen(true);
    };

    window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
    return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
  }, []);
  const allSelected = groups.length > 0 && selectedGroupIds.length === groups.length;

  useEffect(() => {
    if (!selectedGroupIds.length) {
      return;
    }

    const existingIds = new Set(groups.map((group) => group.id));
    setSelectedGroupIds((current) => current.filter((groupId) => existingIds.has(groupId)));
  }, [groups, selectedGroupIds.length]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setTableError(null);
    setTableSuccess(null);

    const trimmedGroupname = groupname.trim();
    if (!trimmedGroupname) {
      setFormError("Group name is required.");
      return;
    }

    const trimmedDescription = description.trim();
    const payload: NewGroup = {
      groupname: trimmedGroupname
    };

    if (trimmedDescription) {
      payload.description = trimmedDescription;
    }

    createMutation.mutate(payload);
  }

  function toggleAllGroups(checked: boolean) {
    if (checked) {
      setSelectedGroupIds(groups.map((group) => group.id));
      return;
    }

    setSelectedGroupIds([]);
  }

  function toggleGroup(groupId: number, checked: boolean) {
    setSelectedGroupIds((current) => {
      if (checked) {
        return current.includes(groupId) ? current : [...current, groupId];
      }
      return current.filter((id) => id !== groupId);
    });
  }

  function deleteSelectedGroups() {
    if (!selectedGroupIds.length) {
      return;
    }

    setTableError(null);
    setTableSuccess(null);

    const confirmed = window.confirm(`Delete ${selectedGroupIds.length} selected group(s)?`);
    if (!confirmed) {
      return;
    }

    deleteMutation.mutate([...selectedGroupIds]);
  }

  function renderCreateGroupForm() {
    return (
      <form className="stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Group name</span>
            <input
              required
              value={groupname}
              onChange={(event) => setGroupname(event.target.value)}
              placeholder="e.g. site-admins"
            />
          </label>

          <label className="control-field control-field--wide">
            <span>Description (optional)</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Group scope and purpose"
            />
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create group"}
          </button>
        </div>
      </form>
    );
  }

  if (query.isLoading) {
    return <div className="card">Loading groups...</div>;
  }

  if (query.isError) {
    return (
      <div className="card error-banner">
        Failed to load groups. {query.error instanceof Error ? query.error.message : "Unknown error"}
      </div>
    );
  }

  return (
    <div className="stack">
      <CreateModal open={isCreateModalOpen} title="Create group" onClose={() => setCreateModalOpen(false)}>
        {renderCreateGroupForm()}
      </CreateModal>

      <div className="card table-wrap">
        <div className="table-header">
          <h3>Group directory</h3>
          <div className="table-tools">
            <span className="muted">
              {groups.length} loaded
              {selectedGroupIds.length ? ` • ${selectedGroupIds.length} selected` : ""}
            </span>
            <button
              type="button"
              className="danger"
              onClick={deleteSelectedGroups}
              disabled={deleteMutation.isPending || selectedGroupIds.length === 0}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete selected"}
            </button>
          </div>
        </div>
        {tableError ? <div className="error-banner">{tableError}</div> : null}
        {tableSuccess ? <div className="muted">{tableSuccess}</div> : null}
        {memberCountsQuery.isError ? (
          <div className="muted">
            Could not load member counts. {memberCountsQuery.error instanceof Error ? memberCountsQuery.error.message : ""}
          </div>
        ) : null}

        <table>
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  aria-label="Select all groups"
                  checked={allSelected}
                  onChange={(event) => toggleAllGroups(event.target.checked)}
                />
              </th>
              <th>ID</th>
              <th>Group name</th>
              <th>Description</th>
              <th>Members</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td className="check-col">
                  <input
                    type="checkbox"
                    aria-label={`Select group ${group.groupname}`}
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={(event) => toggleGroup(group.id, event.target.checked)}
                  />
                </td>
                <td>{group.id}</td>
                <td>
                  <Link className="row-link" href={`/admin/groups/${group.id}`}>
                    {group.groupname}
                  </Link>
                </td>
                <td>{group.description || "-"}</td>
                <td>{memberCountsQuery.isLoading ? "…" : memberCountsQuery.data?.[group.id] ?? 0}</td>
                <td>{new Date(group.created_at).toLocaleString()}</td>
                <td>{new Date(group.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
