"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";

import { getApiV1IamUsers, postApiV1IamUsers } from "@/lib/api/generated/client";
import { CreateModal } from "@/components/create-modal";
import type { NewUser, User } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";
import { OPEN_CREATE_EVENT, type OpenCreateEventDetail } from "@/lib/create-events";

async function fetchUsers(): Promise<User[]> {
  const response = await getApiV1IamUsers({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load users."));
  }

  return response.data;
}

export function AdminUsersTable() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [tableSuccess, setTableSuccess] = useState<string | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const query = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchUsers
  });
  const createMutation = useMutation({
    mutationFn: async (payload: NewUser) => {
      const response = await postApiV1IamUsers(payload, {
        credentials: "include"
      });

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(response.data, "Failed to create user."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setUsername("");
      setPassword("");
      setEmail("");
      setFormError(null);
      setFormSuccess("User created.");
      setTableSuccess("User created.");
      setCreateModalOpen(false);
    },
    onError: (error) => {
      setFormSuccess(null);
      setTableSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to create user.");
    }
  });

  useEffect(() => {
    const onOpenCreate = (event: Event) => {
      const customEvent = event as CustomEvent<OpenCreateEventDetail>;
      if (customEvent.detail?.section !== "admin-users") {
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

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setFormError("Username is required.");
      return;
    }

    if (!password) {
      setFormError("Password is required.");
      return;
    }

    const trimmedEmail = email.trim();
    const payload: NewUser = {
      username: trimmedUsername,
      password
    };

    if (trimmedEmail) {
      payload.email = trimmedEmail;
    }

    createMutation.mutate(payload);
  }

  function renderCreateUserForm() {
    return (
      <form className="stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Username</span>
            <input required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. alice" />
          </label>

          <label className="control-field">
            <span>Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Temporary password"
              autoComplete="new-password"
            />
          </label>

          <label className="control-field control-field--wide">
            <span>Email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create user"}
          </button>
        </div>
      </form>
    );
  }

  if (query.isLoading) {
    return <div className="card">Loading users...</div>;
  }

  if (query.isError) {
    return (
      <div className="card error-banner">
        Failed to load users. {query.error instanceof Error ? query.error.message : "Unknown error"}
      </div>
    );
  }

  const users = query.data ?? [];

  return (
    <div className="stack">
      <CreateModal open={isCreateModalOpen} title="Create user" onClose={() => setCreateModalOpen(false)}>
        {renderCreateUserForm()}
      </CreateModal>

      <div className="card table-wrap">
        <div className="table-header">
          <h3>User directory</h3>
          <span className="muted">{users.length} loaded</span>
        </div>
        {tableSuccess ? <div className="muted">{tableSuccess}</div> : null}

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.username}</td>
                <td>{user.email ?? "-"}</td>
                <td>{new Date(user.created_at).toLocaleString()}</td>
                <td>{new Date(user.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
