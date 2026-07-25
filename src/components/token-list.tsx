"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { TableExportMenu } from "@/components/table-export-menu";
import { TokenDetailsModal } from "@/components/token-details-modal";
import { useConfirm } from "@/lib/confirm-context";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMeTokens,
	getApiV1IamPrincipalsByPrincipalIdTokens,
	postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke,
} from "@/lib/api/generated/client";
import type { PrincipalTokenMetadata } from "@/lib/api/generated/models";
import {
	resolveDirectTokenResourceNames,
	resolveObjectTokenResourceNames,
} from "@/lib/api/token-resource-names";
import type { TableExportView } from "@/lib/table-export";
import { tokenResourceScopeKey } from "@/lib/token-resource-scope-selection";
import { formatTokenMetadataScope } from "@/lib/token-scope-details";

type TokenListProps = {
	createDisabled?: boolean;
	onCreate?: () => void;
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

export function TokenList({
	createDisabled = false,
	onCreate,
	principalId,
}: TokenListProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);

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
	const selectedTokenIndex =
		selectedTokenId === null
			? -1
			: tokens.findIndex((token) => token.id === selectedTokenId);
	const selectedToken =
		selectedTokenIndex >= 0 ? tokens[selectedTokenIndex] : null;
	const selectedResources = selectedToken?.scope?.resources ?? [];
	const directResources = selectedResources.filter(
		(resource) => resource.kind !== "object",
	);
	const objectResources = selectedResources.filter(
		(resource) => resource.kind === "object",
	);
	const directResourceKeys = directResources
		.map(tokenResourceScopeKey)
		.sort();
	const objectLookupResourceKeys = selectedResources
		.filter((resource) => resource.kind === "class" || resource.kind === "object")
		.map(tokenResourceScopeKey)
		.sort();
	const directResourceNamesQuery = useQuery({
		queryKey: ["token-resource-names", "direct", directResourceKeys],
		queryFn: ({ signal }) =>
			resolveDirectTokenResourceNames(directResources, signal),
		enabled: directResources.length > 0,
		staleTime: 5 * 60 * 1000,
	});
	const objectResourceNamesQuery = useQuery({
		queryKey: ["token-resource-names", "object", objectLookupResourceKeys],
		queryFn: ({ signal }) =>
			resolveObjectTokenResourceNames(selectedResources, signal),
		enabled: objectResources.length > 0,
		staleTime: 5 * 60 * 1000,
	});
	const resourceNames = {
		...directResourceNamesQuery.data,
		...objectResourceNamesQuery.data,
	};
	const resourceNamesLoading =
		directResourceNamesQuery.isFetching || objectResourceNamesQuery.isFetching;
	const unresolvedResourceNames = selectedResources.filter(
		(resource) =>
			!resourceNamesLoading && !resourceNames[tokenResourceScopeKey(resource)],
	).length;
	const exportView = useMemo<TableExportView<PrincipalTokenMetadata>>(
		() => ({
			id: `principal-${principalId}-tokens`,
			fileName: `principal-${principalId}-tokens-view`,
			sheetName: "Tokens",
			columns: [
				{ key: "id", label: "ID", getValue: (token) => token.id },
				{ key: "name", label: "Name", getValue: (token) => token.name },
				{
					key: "scope",
					label: "Scope",
					getValue: formatTokenMetadataScope,
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
		<>
			<TokenDetailsModal
				token={selectedToken}
				resourceNames={resourceNames}
				resourceNamesLoading={resourceNamesLoading}
				unresolvedResourceNames={unresolvedResourceNames}
				onClose={() => setSelectedTokenId(null)}
				navigation={
					selectedTokenIndex >= 0
						? {
								current: selectedTokenIndex + 1,
								itemLabel: "token",
								onPrevious:
									selectedTokenIndex > 0
										? () =>
												setSelectedTokenId(tokens[selectedTokenIndex - 1].id)
										: undefined,
								onNext:
									selectedTokenIndex < tokens.length - 1
										? () =>
												setSelectedTokenId(tokens[selectedTokenIndex + 1].id)
										: undefined,
								total: tokens.length,
							}
						: undefined
				}
			/>
			<section className="card stack">
				<div className="table-header">
					<div>
						<h3>Tokens ({tokens.length})</h3>
						<p className="muted">Select a token to inspect its full scope.</p>
					</div>
					<div className="table-tools">
						{onCreate ? (
							<button
								type="button"
								className="token-create-trigger"
								disabled={createDisabled}
								onClick={onCreate}
							>
								Create new
							</button>
						) : null}
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
					<div className="muted">No active tokens.</div>
				) : (
					<div className="table-wrap">
						<table className="token-list-table">
							<thead>
								<tr>
									<th>ID</th>
									<th>Name</th>
									<th>Scope</th>
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
										<tr
											key={token.id}
											className="activity-detail-row"
											tabIndex={0}
											onClick={(event) => {
												const target = event.target;
												if (
													target instanceof Element &&
													target.closest("button, a, input, select, textarea")
												) {
													return;
												}
												setSelectedTokenId(token.id);
											}}
											onKeyDown={(event) => {
												if (
													event.currentTarget !== event.target ||
													(event.key !== "Enter" && event.key !== " ")
												) {
													return;
												}
												event.preventDefault();
												setSelectedTokenId(token.id);
											}}
											aria-label={`View details for token ${token.id}${token.name ? ` ${token.name}` : ""}`}
										>
											<td>#{token.id}</td>
											<td>{token.name ?? "—"}</td>
											<td>{formatTokenMetadataScope(token)}</td>
											<td>{formatTimestamp(token.issued)}</td>
											<td>{formatTimestamp(token.expires_at)}</td>
											<td>{formatTimestamp(token.last_used_at)}</td>
											<td>{revoked ? "Revoked" : "Active"}</td>
											<td>
												<button
													type="button"
													className="danger token-revoke-button"
													onClick={(event) => {
														event.stopPropagation();
														void revoke(token);
													}}
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
		</>
	);
}
