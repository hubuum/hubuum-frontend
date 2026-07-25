"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";

import { TableExportMenu } from "@/components/table-export-menu";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamPrincipalsByPrincipalIdGroups } from "@/lib/api/generated/client";
import {
	type ConsoleGroup,
	normalizeIdentityScope,
} from "@/lib/identity-scopes";
import type { TableExportColumn, TableExportView } from "@/lib/table-export";

type PrincipalGroupMembershipsProps = {
	emptyMessage: string;
	exportId: string;
	fileName: string;
	principalId: number;
};

async function fetchPrincipalGroups(
	principalId: number,
): Promise<ConsoleGroup[]> {
	const response = await getApiV1IamPrincipalsByPrincipalIdGroups(
		principalId,
		{ include_total: false, limit: 250 },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load principal groups."),
		);
	}

	return response.data;
}

const groupMembershipExportColumns: TableExportColumn<ConsoleGroup>[] = [
	{ key: "id", label: "ID", getValue: (group) => group.id },
	{ key: "group", label: "Group", getValue: (group) => group.groupname },
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
