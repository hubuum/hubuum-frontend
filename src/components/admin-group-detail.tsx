"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  deleteApiV1IamGroupsByGroupIdMembersByUserId,
  getApiV1IamGroupsByGroupId,
  getApiV1IamGroupsByGroupIdMembers,
  getApiV1IamUsers,
  postApiV1IamGroupsByGroupIdMembersByUserId
} from "@/lib/api/generated/client";
import type { Group, User } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

type AdminGroupDetailProps = {
  groupId: number;
};

type UpdateGroupPayload = {
  groupname: string;
  description?: string;
};

type UpdateGroupResult = {
  descriptionRequested: boolean;
  descriptionUpdated: boolean;
  group: Group;
};

async function fetchGroup(groupId: number): Promise<Group> {
  const response = await getApiV1IamGroupsByGroupId(groupId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load group."));
  }

  return response.data;
}

async function fetchUsers(): Promise<User[]> {
  const response = await getApiV1IamUsers({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load users."));
  }

  return response.data;
}

async function fetchGroupMembers(groupId: number): Promise<User[]> {
  const response = await getApiV1IamGroupsByGroupIdMembers(groupId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load group members."));
  }

  return response.data;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { message: raw };
  }
}

async function updateGroup(groupId: number, payload: UpdateGroupPayload): Promise<UpdateGroupResult> {
  const response = await fetch(`/api/v1/iam/groups/${groupId}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const responsePayload = await readResponsePayload(response);

  if (response.status === 200) {
    return {
      descriptionRequested: payload.description !== undefined,
      descriptionUpdated: payload.description !== undefined,
      group: responsePayload as Group
    };
  }

  if (payload.description !== undefined) {
    const fallbackResponse = await fetch(`/api/v1/iam/groups/${groupId}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ groupname: payload.groupname })
    });
    const fallbackPayload = await readResponsePayload(fallbackResponse);

    if (fallbackResponse.status === 200) {
      return {
        descriptionRequested: true,
        descriptionUpdated: false,
        group: fallbackPayload as Group
      };
    }

    throw new Error(getApiErrorMessage(fallbackPayload, "Failed to update group."));
  }

  throw new Error(getApiErrorMessage(responsePayload, "Failed to update group."));
}

function formatUserOption(user: User): string {
  return `${user.username} (#${user.id})${user.email ? ` - ${user.email}` : ""}`;
}

function resolveUserFromInput(input: string, availableUsers: User[]): User | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  const exactOption = availableUsers.find((user) => formatUserOption(user).toLowerCase() === normalized);
  if (exactOption) {
    return exactOption;
  }

  const extractedIdMatch = normalized.match(/#(\d+)\)/);
  if (extractedIdMatch) {
    const extractedId = Number.parseInt(extractedIdMatch[1], 10);
    if (Number.isFinite(extractedId)) {
      const matchedByExtractedId = availableUsers.find((user) => user.id === extractedId);
      if (matchedByExtractedId) {
        return matchedByExtractedId;
      }
    }
  }

  const parsedId = Number.parseInt(trimmed, 10);
  if (Number.isFinite(parsedId)) {
    const matchedById = availableUsers.find((user) => user.id === parsedId);
    if (matchedById) {
      return matchedById;
    }
  }

  const matchedByUsername = availableUsers.find((user) => user.username.toLowerCase() === normalized);
  if (matchedByUsername) {
    return matchedByUsername;
  }

  return availableUsers.find((user) => (user.email ?? "").toLowerCase() === normalized) ?? null;
}

export function AdminGroupDetail({ groupId }: AdminGroupDetailProps) {
  const queryClient = useQueryClient();
  const [groupname, setGroupname] = useState("");
  const [description, setDescription] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [membershipSuccess, setMembershipSuccess] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const datalistId = `admin-group-member-options-${groupId}`;

  const groupQuery = useQuery({
    queryKey: ["admin-group", groupId],
    queryFn: async () => fetchGroup(groupId)
  });
  const usersQuery = useQuery({
    queryKey: ["admin-users", "group-detail"],
    queryFn: fetchUsers
  });
  const membersQuery = useQuery({
    queryKey: ["admin-group-members", groupId],
    queryFn: async () => fetchGroupMembers(groupId)
  });

  useEffect(() => {
    if (initialized || !groupQuery.data) {
      return;
    }

    setGroupname(groupQuery.data.groupname);
    setDescription(groupQuery.data.description ?? "");
    setInitialized(true);
  }, [groupQuery.data, initialized]);

  const members = membersQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const memberIdSet = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const allMembersSelected = members.length > 0 && selectedMemberIds.length === members.length;
  const usersNotInGroup = useMemo(() => users.filter((user) => !memberIdSet.has(user.id)), [users, memberIdSet]);
  const memberInputTerm = memberInput.trim().toLowerCase();
  const memberSuggestions = useMemo(() => {
    const filteredUsers = memberInputTerm
      ? usersNotInGroup.filter((user) => {
          return (
            user.username.toLowerCase().includes(memberInputTerm) ||
            (user.email ?? "").toLowerCase().includes(memberInputTerm) ||
            String(user.id).includes(memberInputTerm)
          );
        })
      : usersNotInGroup;

    return filteredUsers.slice(0, 50);
  }, [memberInputTerm, usersNotInGroup]);

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateGroupPayload) => updateGroup(groupId, payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-group", groupId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
      setGroupname(result.group.groupname);
      setDescription(result.group.description ?? "");
      setFormError(null);
      setFormSuccess(
        result.descriptionRequested && !result.descriptionUpdated
          ? "Group name updated. This API currently does not accept description updates."
          : "Group updated."
      );
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to update group.");
    }
  });

  const addMemberMutation = useMutation({
    mutationFn: async (userId: number) => {
      const response = await postApiV1IamGroupsByGroupIdMembersByUserId(groupId, userId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to add user to group."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-group-members", groupId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-group-member-counts"] });
      setMembershipError(null);
      setMembershipSuccess("User added to group.");
      setMemberInput("");
    },
    onError: (error) => {
      setMembershipSuccess(null);
      setMembershipError(error instanceof Error ? error.message : "Failed to add user to group.");
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userIds: number[]) => {
      await Promise.all(
        userIds.map(async (userId) => {
          const response = await deleteApiV1IamGroupsByGroupIdMembersByUserId(groupId, userId, {
            credentials: "include"
          });

          if (response.status !== 204) {
            throw new Error(getApiErrorMessage(response.data, `Failed to remove user #${userId} from group.`));
          }
        })
      );

      return userIds.length;
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-group-members", groupId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-group-member-counts"] });
      setSelectedMemberIds([]);
      setMembershipError(null);
      setMembershipSuccess(`${count} member${count === 1 ? "" : "s"} removed from group.`);
    },
    onError: (error) => {
      setMembershipSuccess(null);
      setMembershipError(error instanceof Error ? error.message : "Failed to remove user from group.");
    }
  });

  useEffect(() => {
    if (!selectedMemberIds.length) {
      return;
    }

    const existingIds = new Set(members.map((member) => member.id));
    setSelectedMemberIds((current) => current.filter((memberId) => existingIds.has(memberId)));
  }, [members, selectedMemberIds.length]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const trimmedGroupname = groupname.trim();
    if (!trimmedGroupname) {
      setFormError("Group name is required.");
      return;
    }

    const trimmedDescription = description.trim();
    const originalDescription = (groupQuery.data?.description ?? "").trim();
    const payload: UpdateGroupPayload = {
      groupname: trimmedGroupname
    };

    if (trimmedDescription !== originalDescription) {
      payload.description = trimmedDescription;
    }

    updateMutation.mutate(payload);
  }

  function addMember() {
    if (addMemberMutation.isPending || removeMemberMutation.isPending) {
      return;
    }

    const targetUser = resolveUserFromInput(memberInput, usersNotInGroup);
    if (!targetUser) {
      setMembershipSuccess(null);
      setMembershipError("Select a user from autocomplete suggestions, or enter exact username, email, or user ID.");
      return;
    }

    setMembershipError(null);
    setMembershipSuccess(null);
    addMemberMutation.mutate(targetUser.id);
  }

  function toggleAllMembers(checked: boolean) {
    if (checked) {
      setSelectedMemberIds(members.map((member) => member.id));
      return;
    }

    setSelectedMemberIds([]);
  }

  function toggleMember(userId: number, checked: boolean) {
    setSelectedMemberIds((current) => {
      if (checked) {
        return current.includes(userId) ? current : [...current, userId];
      }

      return current.filter((id) => id !== userId);
    });
  }

  function removeSelectedMembers() {
    if (addMemberMutation.isPending || removeMemberMutation.isPending) {
      return;
    }

    if (!selectedMemberIds.length) {
      return;
    }

    const confirmed = window.confirm(`Remove ${selectedMemberIds.length} selected member(s) from this group?`);
    if (!confirmed) {
      return;
    }

    setMembershipError(null);
    setMembershipSuccess(null);
    removeMemberMutation.mutate([...selectedMemberIds]);
  }

  if (groupQuery.isLoading) {
    return <div className="card">Loading group...</div>;
  }

  if (groupQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load group. {groupQuery.error instanceof Error ? groupQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const group = groupQuery.data;
  if (!group) {
    return <div className="card error-banner">Group data is unavailable.</div>;
  }

  const isMembershipUpdating = addMemberMutation.isPending || removeMemberMutation.isPending;

  return (
    <section className="stack">
      <header className="stack">
        <p className="eyebrow">Admin / Groups</p>
        <div className="scope-heading">
          <h2>
            {group.groupname} (#{group.id})
          </h2>
          <Link className="link-chip" href="/admin/groups">
            Back to groups
          </Link>
        </div>
      </header>

      <form className="card stack" onSubmit={onSubmit}>
        <h3>Group profile</h3>

        <div className="form-grid">
          <label className="control-field">
            <span>Group name</span>
            <input required value={groupname} onChange={(event) => setGroupname(event.target.value)} />
          </label>

          <label className="control-field control-field--wide">
            <span>Description</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>

      <section className="card stack">
        <h3>Members ({members.length})</h3>

        <div className="form-grid">
          <label className="control-field control-field--wide">
            <span>Add user</span>
            <input
              list={datalistId}
              value={memberInput}
              onChange={(event) => setMemberInput(event.target.value)}
              placeholder="Type username, email, or user ID"
              disabled={usersQuery.isLoading || usersQuery.isError || isMembershipUpdating || usersNotInGroup.length === 0}
            />
            <datalist id={datalistId}>
              {memberSuggestions.map((user) => (
                <option key={user.id} value={formatUserOption(user)} />
              ))}
            </datalist>
          </label>
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={addMember}
            disabled={usersQuery.isLoading || usersQuery.isError || isMembershipUpdating || usersNotInGroup.length === 0}
          >
            {addMemberMutation.isPending ? "Adding..." : "Add member"}
          </button>
          <span className="muted">
            {usersNotInGroup.length === 0
              ? "All users are already members."
              : `${usersNotInGroup.length} user${usersNotInGroup.length === 1 ? "" : "s"} available to add.`}
          </span>
        </div>

        {usersQuery.isError ? (
          <div className="error-banner">
            Failed to load users. {usersQuery.error instanceof Error ? usersQuery.error.message : "Unknown error"}
          </div>
        ) : null}
        {membersQuery.isError ? (
          <div className="error-banner">
            Failed to load group members. {membersQuery.error instanceof Error ? membersQuery.error.message : "Unknown error"}
          </div>
        ) : null}
        {membershipError ? <div className="error-banner">{membershipError}</div> : null}
        {membershipSuccess ? <div className="muted">{membershipSuccess}</div> : null}

        {membersQuery.isLoading ? <div className="muted">Loading members...</div> : null}
        {!membersQuery.isLoading && members.length === 0 ? <div className="muted">No members in this group.</div> : null}

        {!membersQuery.isLoading && members.length > 0 ? (
          <div className="table-wrap">
            <div className="table-header">
              <h4>Current members</h4>
              <div className="table-tools">
                <span className="muted">{selectedMemberIds.length ? `${selectedMemberIds.length} selected` : ""}</span>
                <button
                  type="button"
                  className="danger"
                  onClick={removeSelectedMembers}
                  disabled={isMembershipUpdating || selectedMemberIds.length === 0}
                >
                  {removeMemberMutation.isPending ? "Removing..." : "Remove selected"}
                </button>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th className="check-col">
                    <input
                      type="checkbox"
                      aria-label="Select all members"
                      checked={allMembersSelected}
                      onChange={(event) => toggleAllMembers(event.target.checked)}
                    />
                  </th>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="check-col">
                      <input
                        type="checkbox"
                        aria-label={`Select member ${member.username}`}
                        checked={selectedMemberIds.includes(member.id)}
                        onChange={(event) => toggleMember(member.id, event.target.checked)}
                        disabled={isMembershipUpdating}
                      />
                    </td>
                    <td>{member.id}</td>
                    <td>{member.username}</td>
                    <td>{member.email ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}
