"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { TableExportMenu } from "@/components/table-export-menu";
import { useConfirm } from "@/lib/confirm-context";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMeTokens,
	getApiV1IamPrincipalsByPrincipalIdTokens,
	postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke,
} from "@/lib/api/generated/client";
import type { PrincipalTokenMetadata } from "@/lib/api/generated/models";
import type { TableExportView } from "@/lib/table-export";

type TokenListProps = {
	principalId: number | "me";
};

async function fetchTokens(
	principalId: number | "me",
): Promise<PrincipalTokenMetadata[]> {
	const response =
		principalId === "me"
			? await getApiV1IamMeTokens(
					{ include_total: false },
					{ credentials: "include" },
				)
			: await getApiV1IamPrincipalsByPrincipalIdTokens(
					principalId,
					{ include_total: false },
					{ credentials: "include" },
				);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load tokens."),
		);
	}

	return response.data;
}

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "—";
	}
	return new Date(value).toLocaleString();
}

export function TokenList({ principalId }: TokenListProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const tokensQuery = useQuery({
		queryKey: ["principal-tokens", principalId],
		queryFn: async () => fetchTokens(principalId),
	});

	const revokeMutation = useMutation({
		mutationFn: async (token: PrincipalTokenMetadata) => {
			const response =
				await postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke(
					token.principal_id,
					token.id,
					{ credentials: "include" },
				);

			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to revoke token."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", principalId],
			});
		},
	});
	const tokens = tokensQuery.data ?? [];
	const exportView = useMemo<TableExportView<PrincipalTokenMetadata>>(
		() => ({
			id: `principal-${principalId}-tokens`,
			fileName: `principal-${principalId}-tokens-view`,
			sheetName: "Tokens",
			columns: [
				{ key: "id", label: "ID", getValue: (token) => token.id },
				{ key: "name", label: "Name", getValue: (token) => token.name },
				{
					key: "scoped",
					label: "Scoped",
					getValue: (token) => (token.scoped ? "Scoped" : "Unscoped"),
				},
				{
					key: "issued",
					label: "Issued",
					getValue: (token) => new Date(token.issued),
				},
				{
					key: "expires_at",
					label: "Expires",
					getValue: (token) =>
						token.expires_at ? new Date(token.expires_at) : null,
				},
				{
					key: "last_used_at",
					label: "Last used",
					getValue: (token) =>
						token.last_used_at ? new Date(token.last_used_at) : null,
				},
				{
					key: "status",
					label: "Status",
					getValue: (token) => (token.revoked_at ? "Revoked" : "Active"),
				},
			],
			rows: tokens,
		}),
		[principalId, tokens],
	);

	async function revoke(token: PrincipalTokenMetadata) {
		const confirmed = await confirm({
			title: `Revoke token #${token.id}?`,
			description: "This cannot be undone.",
			confirmLabel: "Revoke",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}
		revokeMutation.mutate(token);
	}

	if (tokensQuery.isLoading) {
		return <div className="card">Loading tokens...</div>;
	}

	if (tokensQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load tokens.{" "}
				{tokensQuery.error instanceof Error
					? tokensQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	return (
		<section className="card stack">
			<div className="table-header">
				<h3>Tokens ({tokens.length})</h3>
				<div className="table-tools">
					<TableExportMenu view={exportView} compact />
				</div>
			</div>

			{revokeMutation.isError ? (
				<div className="error-banner">
					{revokeMutation.error instanceof Error
						? revokeMutation.error.message
						: "Failed to revoke token."}
				</div>
			) : null}

			{tokens.length === 0 ? (
				<div className="muted">No tokens.</div>
			) : (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>Name</th>
								<th>Scoped</th>
								<th>Issued</th>
								<th>Expires</th>
								<th>Last used</th>
								<th>Status</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{tokens.map((token) => {
								const revoked = Boolean(token.revoked_at);
								return (
									<tr key={token.id}>
										<td>{token.id}</td>
										<td>{token.name ?? "—"}</td>
										<td>{token.scoped ? "Scoped" : "Unscoped"}</td>
										<td>{formatTimestamp(token.issued)}</td>
										<td>{formatTimestamp(token.expires_at)}</td>
										<td>{formatTimestamp(token.last_used_at)}</td>
										<td>{revoked ? "Revoked" : "Active"}</td>
										<td>
											<button
												type="button"
												className="danger"
												onClick={() => revoke(token)}
												disabled={revoked || revokeMutation.isPending}
											>
												Revoke
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
