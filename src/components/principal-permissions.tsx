"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMePermissions,
	getApiV1IamPrincipalsByPrincipalIdPermissions,
} from "@/lib/api/generated/client";
import type { PrincipalNamespacePermissions } from "@/lib/api/generated/models";

type PrincipalPermissionsProps = {
	principalId: number | "me";
};

async function fetchPermissions(
	principalId: number | "me",
): Promise<PrincipalNamespacePermissions[]> {
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

	const namespaces = permissionsQuery.data ?? [];

	if (namespaces.length === 0) {
		return (
			<div className="card muted">
				No effective permissions on any namespace.
			</div>
		);
	}

	return (
		<section className="stack">
			{namespaces.map((namespace) => (
				<div key={namespace.namespace_id} className="card stack">
					<h4>
						{namespace.namespace_name}{" "}
						<span className="muted">#{namespace.namespace_id}</span>
					</h4>
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Granted by group</th>
									<th>Permissions</th>
								</tr>
							</thead>
							<tbody>
								{namespace.grants.map((grant) => (
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
			))}
		</section>
	);
}
