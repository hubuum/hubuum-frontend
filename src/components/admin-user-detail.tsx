"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  deleteApiV1IamUsersByUserId,
  getApiV1IamUsersByUserId,
  getApiV1IamUsersByUserIdGroups,
  patchApiV1IamUsersByUserId
} from "@/lib/api/generated/client";
import type { Group, UpdateUser, User } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

type AdminUserDetailProps = {
  userId: number;
};

async function fetchUser(userId: number): Promise<User> {
  const response = await getApiV1IamUsersByUserId(userId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load user."));
  }

  return response.data;
}

async function fetchUserGroups(userId: number): Promise<Group[]> {
  const response = await getApiV1IamUsersByUserIdGroups(userId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load user groups."));
  }

  return response.data;
}

export function AdminUserDetail({ userId }: AdminUserDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const userQuery = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: async () => fetchUser(userId)
  });
  const groupsQuery = useQuery({
    queryKey: ["admin-user-groups", userId],
    queryFn: async () => fetchUserGroups(userId)
  });

  useEffect(() => {
    if (initialized || !userQuery.data) {
      return;
    }

    setUsername(userQuery.data.username);
    setEmail(userQuery.data.email ?? "");
    setInitialized(true);
  }, [initialized, userQuery.data]);

  const groups = groupsQuery.data ?? [];
  const sortedGroups = useMemo(() => {
    return [...groups].sort((left, right) => left.groupname.localeCompare(right.groupname));
  }, [groups]);

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateUser) => {
      const response = await patchApiV1IamUsersByUserId(userId, payload, {
        credentials: "include"
      });

      if (response.status !== 200) {
        throw new Error(getApiErrorMessage(response.data, "Failed to update user."));
      }

      return response.data;
    },
    onSuccess: async (updatedUser) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-user", userId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-users", "group-detail"] });
      setUsername(updatedUser.username);
      setEmail(updatedUser.email ?? "");
      setPassword("");
      setFormError(null);
      setFormSuccess("User updated.");
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to update user.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await deleteApiV1IamUsersByUserId(userId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to delete user."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-users", "group-detail"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-user-groups"] });
      router.push("/admin/users");
      router.refresh();
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to delete user.");
    }
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const originalUser = userQuery.data;
    if (!originalUser) {
      setFormError("User data is unavailable.");
      return;
    }

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setFormError("Username is required.");
      return;
    }

    const trimmedEmail = email.trim();
    const payload: UpdateUser = {};

    if (trimmedUsername !== originalUser.username) {
      payload.username = trimmedUsername;
    }

    const originalEmail = originalUser.email ?? "";
    if (trimmedEmail !== originalEmail) {
      payload.email = trimmedEmail || null;
    }

    if (password) {
      payload.password = password;
    }

    if (!Object.keys(payload).length) {
      setFormSuccess("No changes to save.");
      return;
    }

    updateMutation.mutate(payload);
  }

  function onDelete() {
    setFormError(null);
    setFormSuccess(null);
    if (!window.confirm(`Delete user #${userId}?`)) {
      return;
    }

    deleteMutation.mutate();
  }

  if (userQuery.isLoading) {
    return <div className="card">Loading user...</div>;
  }

  if (userQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load user. {userQuery.error instanceof Error ? userQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const user = userQuery.data;
  if (!user) {
    return <div className="card error-banner">User data is unavailable.</div>;
  }

  return (
    <section className="stack">
      <header className="stack">
        <p className="eyebrow">Admin / Users</p>
        <div className="scope-heading">
          <h2>
            {user.username} (#{user.id})
          </h2>
          <Link className="link-chip" href="/admin/users">
            Back to users
          </Link>
        </div>
      </header>

      <form className="card stack" onSubmit={onSubmit}>
        <h3>User profile</h3>

        <div className="form-grid">
          <label className="control-field">
            <span>Username</span>
            <input required value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>

          <label className="control-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </label>

          <label className="control-field control-field--wide">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Leave blank to keep the current password"
              autoComplete="new-password"
            />
          </label>
        </div>

        <div className="muted">
          Created {new Date(user.created_at).toLocaleString()} • Last updated {new Date(user.updated_at).toLocaleString()}
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions form-actions--spread">
          <button type="submit" disabled={updateMutation.isPending || deleteMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save changes"}
          </button>
          <button type="button" className="danger" onClick={onDelete} disabled={updateMutation.isPending || deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting..." : "Delete user"}
          </button>
        </div>
      </form>

      <section className="card stack">
        <h3>Group memberships</h3>

        {groupsQuery.isLoading ? <div className="muted">Loading groups...</div> : null}
        {groupsQuery.isError ? (
          <div className="error-banner">
            Failed to load user groups. {groupsQuery.error instanceof Error ? groupsQuery.error.message : "Unknown error"}
          </div>
        ) : null}
        {!groupsQuery.isLoading && !groupsQuery.isError && sortedGroups.length === 0 ? (
          <div className="muted">This user is not a member of any groups.</div>
        ) : null}
        {!groupsQuery.isLoading && !groupsQuery.isError && sortedGroups.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Group</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {sortedGroups.map((group) => (
                  <tr key={group.id}>
                    <td>{group.id}</td>
                    <td>
                      <Link className="row-link" href={`/admin/groups/${group.id}`}>
                        {group.groupname}
                      </Link>
                    </td>
                    <td>{group.description || "-"}</td>
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
