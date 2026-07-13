"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { TableExportMenu } from "@/components/table-export-menu";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamMeGroups } from "@/lib/api/generated/client";
import {
	type ConsoleGroup,
	formatScopedIdentityName,
	normalizeIdentityScope,
} from "@/lib/identity-scopes";
import type { TableExportView } from "@/lib/table-export";

async function fetchGroups(): Promise<ConsoleGroup[]> {
	const response = await getApiV1IamMeGroups(
		{ include_total: false },
		{
			credentials: "include",
		},
	);

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
	const exportView: TableExportView<ConsoleGroup> = {
		id: "account-groups",
		fileName: "my-groups-view",
		sheetName: "My groups",
		columns: [
			{ key: "id", label: "ID", getValue: (group) => group.id },
			{
				key: "group",
				label: "Group",
				getValue: (group) =>
					formatScopedIdentityName(group.identity_scope, group.groupname),
			},
			{
				key: "managed_by",
				label: "Managed by",
				getValue: (group) => group.managed_by ?? "local",
			},
			{
				key: "description",
				label: "Description",
				getValue: (group) => group.description,
			},
		],
		rows: groups,
	};

	return (
		<div className="card">
			<div className="table-header">
				<div className="table-title-row">
					<h3>My groups</h3>
					<span className="muted table-count">{groups.length} loaded</span>
				</div>
				<div className="table-tools">
					<TableExportMenu view={exportView} compact />
				</div>
			</div>
			<div className="table-wrap">
				<table>
					<thead>
						<tr>
							<th>ID</th>
							<th>Scope</th>
							<th>Group</th>
							<th>Managed by</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						{groups.map((group) => (
							<tr key={group.id}>
								<td>{group.id}</td>
								<td>{normalizeIdentityScope(group.identity_scope)}</td>
								<td>
									<Link className="row-link" href={`/admin/groups/${group.id}`}>
										{group.groupname}
									</Link>
								</td>
								<td>{group.managed_by ?? "local"}</td>
								<td>{group.description || "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
