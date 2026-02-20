"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";

import { getApiV1IamGroups, postApiV1IamGroups } from "@/lib/api/generated/client";
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

export function AdminGroupsTable() {
  const queryClient = useQueryClient();
  const [groupname, setGroupname] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [tableSuccess, setTableSuccess] = useState<string | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const query = useQuery({
    queryKey: ["admin-groups"],
    queryFn: fetchGroups
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
      setGroupname("");
      setDescription("");
      setFormError(null);
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
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

  const groups = query.data ?? [];

  return (
    <div className="stack">
      <CreateModal open={isCreateModalOpen} title="Create group" onClose={() => setCreateModalOpen(false)}>
        {renderCreateGroupForm()}
      </CreateModal>

      <div className="card table-wrap">
        <div className="table-header">
          <h3>Group directory</h3>
          <span className="muted">{groups.length} loaded</span>
        </div>
        {tableSuccess ? <div className="muted">{tableSuccess}</div> : null}

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Group name</th>
              <th>Description</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td>{group.id}</td>
                <td>{group.groupname}</td>
                <td>{group.description || "-"}</td>
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
