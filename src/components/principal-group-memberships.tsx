"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";

import { TableExportMenu } from "@/components/table-export-menu";
import { fetchPrincipalGroups } from "@/lib/api/principal-groups";
import {
	type ConsoleGroup,
	isProviderManagedGroup,
	normalizeIdentityScope,
} from "@/lib/identity-scopes";
import type { TableExportColumn, TableExportView } from "@/lib/table-export";

type PrincipalGroupMembershipsProps = {
	emptyMessage: string;
	exportId: string;
	fileName: string;
	principalId: number;
};

const groupMembershipExportColumns: TableExportColumn<ConsoleGroup>[] = [
	{ key: "id", label: "ID", getValue: (group) => group.id },
	{ key: "group", label: "Group", getValue: (group) => group.groupname },
	{
		key: "management",
		label: "Group management",
		getValue: (group) =>
			isProviderManagedGroup(group) ? `Provider: ${group.managed_by}` : "Local",
	},
	{
		key: "identity_scope",
		label: "Identity scope",
		getValue: (group) => normalizeIdentityScope(group.identity_scope),
	},
	{
		key: "description",
		label: "Description",
		getValue: (group) => group.description || "-",
	},
];

export function PrincipalGroupMemberships({
	emptyMessage,
	exportId,
	fileName,
	principalId,
}: PrincipalGroupMembershipsProps) {
	const groupsQuery = useQuery({
		queryKey: ["principal-groups", principalId],
		queryFn: async () => fetchPrincipalGroups(principalId),
	});
	const sortedGroups = useMemo(
		() =>
			[...(groupsQuery.data ?? [])].sort((left, right) =>
				left.groupname.localeCompare(right.groupname),
			),
		[groupsQuery.data],
	);
	const exportView: TableExportView<ConsoleGroup> = {
		id: exportId,
		fileName,
		sheetName: "Group memberships",
		columns: groupMembershipExportColumns,
		rows: sortedGroups,
	};

	return (
		<section className="card stack">
			<div className="table-header">
				<h3>Group memberships</h3>
				<TableExportMenu
					view={exportView}
					disabled={groupsQuery.isFetching}
					compact
				/>
			</div>
			<p className="muted">
				Provider-managed groups are read-only. Local groups support manual
				grants, including grants to external identities. This list shows group
				management, not a separate history of each membership source.
			</p>

			{groupsQuery.isLoading ? (
				<div className="muted">Loading groups...</div>
			) : null}
			{groupsQuery.isError ? (
				<div className="error-banner">
					Failed to load group memberships.{" "}
					{groupsQuery.error instanceof Error
						? groupsQuery.error.message
						: "Unknown error"}
				</div>
			) : null}
			{!groupsQuery.isLoading &&
			!groupsQuery.isError &&
			sortedGroups.length === 0 ? (
				<div className="muted">{emptyMessage}</div>
			) : null}
			{!groupsQuery.isLoading &&
			!groupsQuery.isError &&
			sortedGroups.length > 0 ? (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>Scope</th>
								<th>Group</th>
								<th>Group management</th>
								<th>Description</th>
							</tr>
						</thead>
						<tbody>
							{sortedGroups.map((group) => (
								<tr key={group.id}>
									<td>{group.id}</td>
									<td>{normalizeIdentityScope(group.identity_scope)}</td>
									<td>
										<Link
											className="row-link"
											href={`/admin/groups/${group.id}`}
										>
											{group.groupname}
										</Link>
									</td>
									<td>
										{isProviderManagedGroup(group)
											? `Provider: ${group.managed_by}`
											: "Local"}
									</td>
									<td>{group.description || "-"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</section>
	);
}
