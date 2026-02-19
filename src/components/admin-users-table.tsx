"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiV1IamUsers } from "@/lib/api/generated/client";
import type { User } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

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
  const query = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchUsers
  });

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
    <div className="card table-wrap">
      <div className="table-header">
        <h3>User directory</h3>
        <span className="muted">{users.length} loaded</span>
      </div>

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
  );
}
