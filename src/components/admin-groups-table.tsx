"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiV1IamGroups } from "@/lib/api/generated/client";
import type { Group } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

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
  const query = useQuery({
    queryKey: ["admin-groups"],
    queryFn: fetchGroups
  });

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
    <div className="card table-wrap">
      <div className="table-header">
        <h3>Group directory</h3>
        <span className="muted">{groups.length} loaded</span>
      </div>

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
  );
}
