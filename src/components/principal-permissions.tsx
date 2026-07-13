"use client";

import { useQuery } from "@tanstack/react-query";

import { TableExportMenu } from "@/components/table-export-menu";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMePermissions,
	getApiV1IamPrincipalsByPrincipalIdPermissions,
} from "@/lib/api/generated/client";
import type { PrincipalCollectionPermissions } from "@/lib/api/generated/models";

type PrincipalPermissionsProps = {
	principalId: number | "me";
};

async function fetchPermissions(
	principalId: number | "me",
): Promise<PrincipalCollectionPermissions[]> {
	const response =
		principalId === "me"
			? await getApiV1IamMePermissions({ credentials: "include" })
			: await getApiV1IamPrincipalsByPrincipalIdPermissions(principalId, {
					credentials: "include",
				});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load permissions."),
		);
	}

	return response.data;
}

export function PrincipalPermissions({
	principalId,
}: PrincipalPermissionsProps) {
	const permissionsQuery = useQuery({
		queryKey: ["principal-permissions", principalId],
		queryFn: async () => fetchPermissions(principalId),
	});

	if (permissionsQuery.isLoading) {
		return <div className="card">Loading permissions...</div>;
	}

	if (permissionsQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load permissions.{" "}
				{permissionsQuery.error instanceof Error
					? permissionsQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const collections = permissionsQuery.data ?? [];

	if (collections.length === 0) {
		return (
			<div className="card muted">No direct permissions on any collection.</div>
		);
	}

	return (
		<section className="stack">
			{collections.map((collection) => {
				const exportView = {
					id: `principal-permissions-${principalId}-collection-${collection.collection_id}`,
					fileName: `${collection.collection_name}-permissions`,
					sheetName: "Permissions",
					columns: [
						{
							key: "group",
							label: "Granted by group",
							getValue: (grant: (typeof collection.grants)[number]) =>
								`${grant.groupname} #${grant.group_id}`,
						},
						{
							key: "permissions",
							label: "Permissions",
							getValue: (grant: (typeof collection.grants)[number]) =>
								grant.permissions.join(", "),
						},
					],
					rows: collection.grants,
				};

				return (
					<div key={collection.collection_id} className="card stack">
						<div className="panel-header">
							<h4>
								{collection.collection_name}{" "}
								<span className="muted">#{collection.collection_id}</span>
							</h4>
							<TableExportMenu view={exportView} compact />
						</div>
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>Granted by group</th>
										<th>Permissions</th>
									</tr>
								</thead>
								<tbody>
									{collection.grants.map((grant) => (
										<tr key={grant.group_id}>
											<td>
												{grant.groupname}{" "}
												<span className="muted">#{grant.group_id}</span>
											</td>
											<td>
												<div className="chip-row">
													{grant.permissions.map((permission) => (
														<span key={permission} className="badge">
															{permission}
														</span>
													))}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				);
			})}
		</section>
	);
}
