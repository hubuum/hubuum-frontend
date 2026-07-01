"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamMeGroups } from "@/lib/api/generated/client";
import type { Group } from "@/lib/api/generated/models";

async function fetchGroups(): Promise<Group[]> {
	const response = await getApiV1IamMeGroups(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load groups."),
		);
	}

	return response.data;
}

export function AccountGroups() {
	const groupsQuery = useQuery({
		queryKey: ["me-groups"],
		queryFn: fetchGroups,
	});

	if (groupsQuery.isLoading) {
		return <div className="card muted">Loading groups…</div>;
	}

	if (groupsQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load groups.{" "}
				{groupsQuery.error instanceof Error
					? groupsQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const groups = groupsQuery.data ?? [];
	if (groups.length === 0) {
		return (
			<div className="card muted">You are not a member of any groups.</div>
		);
	}

	return (
		<div className="card table-wrap">
			<table>
				<thead>
					<tr>
						<th>ID</th>
						<th>Group</th>
						<th>Description</th>
					</tr>
				</thead>
				<tbody>
					{groups.map((group) => (
						<tr key={group.id}>
							<td>{group.id}</td>
							<td>
								<Link className="row-link" href={`/admin/groups/${group.id}`}>
									{group.groupname}
								</Link>
							</td>
							<td>{group.description || "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
