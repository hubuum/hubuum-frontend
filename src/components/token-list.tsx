"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { TableExportMenu } from "@/components/table-export-menu";
import { TablePagination } from "@/components/table-pagination";
import { TokenActivitySummary } from "@/components/token-activity-summary";
import { TokenDetailsModal } from "@/components/token-details-modal";
import { useConfirm } from "@/lib/confirm-context";
import { getApiErrorMessage } from "@/lib/api/errors";
import { postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke } from "@/lib/api/generated/client";
import {
	TokenListState,
	type MeResponse,
	type PrincipalTokenMetadata,
} from "@/lib/api/generated/models";
import { fetchTokenPage } from "@/lib/api/token-overview";
import {
	resolveDirectTokenResourceNames,
	resolveObjectTokenResourceNames,
	type TokenResourceNameMap,
} from "@/lib/api/token-resource-names";
import type { TableExportView } from "@/lib/table-export";
import {
	formatTokenLifecycleStatus,
	getTokenLifecycleStatus,
} from "@/lib/token-lifecycle";
import { tokenResourceScopeKey } from "@/lib/token-resource-scope-selection";
import { currentSessionToken } from "@/lib/token-overview";
import { formatTokenMetadataScope } from "@/lib/token-scope-details";

type TokenListProps = {
	createDisabled?: boolean;
	currentPrincipal?: MeResponse;
	onClone?: (
		token: PrincipalTokenMetadata,
		resourceNames: TokenResourceNameMap,
	) => void;
	onCreate?: () => void;
	principalId: number | "me";
};

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "—";
	}
	return new Date(value).toLocaleString();
}

export function TokenList({
	createDisabled = false,
	currentPrincipal,
	onClone,
	onCreate,
	principalId,
}: TokenListProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [selection, setSelection] = useState<PrincipalTokenMetadata | null>(
		null,
	);
	const [state, setState] = useState<TokenListState>("active");
	const [sort, setSort] = useState("-issued_at");
	const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
	const cursor = cursors[cursors.length - 1];
	const [showActivity, setShowActivity] = useState(false);
	const currentToken = currentSessionToken(currentPrincipal, principalId);

	const tokensQuery = useQuery({
		queryKey: ["principal-tokens", principalId, state, sort, cursor],
		queryFn: ({ signal }) =>
			fetchTokenPage(principalId, state, sort, cursor, signal),
		refetchOnWindowFocus: true,
		refetchInterval: 30_000,
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
	const tokens = tokensQuery.data?.tokens ?? [];
	const nextCursor = tokensQuery.data?.nextCursor;
	const selectedTokenIndex =
		selection === null
			? -1
			: tokens.findIndex((token) => token.id === selection.id);
	const selectedToken =
		selectedTokenIndex >= 0 ? tokens[selectedTokenIndex] : selection;
	const selectedResources = selectedToken?.scope?.resources ?? [];
	const directResources = selectedResources.filter(
		(resource) => resource.kind !== "object",
	);
	const objectResources = selectedResources.filter(
		(resource) => resource.kind === "object",
	);
	const directResourceKeys = directResources.map(tokenResourceScopeKey).sort();
	const objectLookupResourceKeys = selectedResources
		.filter(
			(resource) => resource.kind === "class" || resource.kind === "object",
		)
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
					key: "description",
					label: "Description",
					getValue: (token) => token.description,
				},
				{
					key: "current_session",
					label: "Current web session",
					getValue: (token) => token.id === currentToken?.id,
				},
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
					getValue: (token) =>
						formatTokenLifecycleStatus(getTokenLifecycleStatus(token)),
				},
			],
			rows: tokens,
		}),
		[principalId, tokens, currentToken?.id],
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

	return (
		<>
			<TokenDetailsModal
				token={selectedToken}
				onClone={
					onClone && selectedToken
						? () => {
								onClone(selectedToken, resourceNames);
								setSelection(null);
							}
						: undefined
				}
				resourceNames={resourceNames}
				resourceNamesLoading={resourceNamesLoading}
				unresolvedResourceNames={unresolvedResourceNames}
				onClose={() => setSelection(null)}
				navigation={
					selectedTokenIndex >= 0
						? {
								current: selectedTokenIndex + 1,
								itemLabel: "token",
								onPrevious:
									selectedTokenIndex > 0
										? () => setSelection(tokens[selectedTokenIndex - 1])
										: undefined,
								onNext:
									selectedTokenIndex < tokens.length - 1
										? () => setSelection(tokens[selectedTokenIndex + 1])
										: undefined,
								total: tokens.length,
							}
						: undefined
				}
			/>
			{currentToken ? (
				<section className="card stack" aria-label="Current web session">
					<div className="table-header">
						<h3>Current web session</h3>
						<button
							type="button"
							className="ghost"
							onClick={() => setSelection(currentToken)}
						>
							Inspect current token #{currentToken.id}
						</button>
					</div>
					<dl className="event-detail-grid">
						<div>
							<dt>Access token</dt>
							<dd>#{currentToken.id}</dd>
						</div>
						<div>
							<dt>Scope</dt>
							<dd>{formatTokenMetadataScope(currentToken)}</dd>
						</div>
						<div>
							<dt>Access expires</dt>
							<dd>
								{currentToken.expires_at
									? formatTimestamp(currentToken.expires_at)
									: "Server default lifetime"}
							</dd>
						</div>
					</dl>
					<p className="muted">
						This browser uses a rotating access token. Its ID and expiry change
						as the session refreshes; the session&apos;s activity history is
						shared across rotations. Checked every 30 seconds and when you
						refresh this overview.
					</p>
				</section>
			) : null}
			<section className="card stack">
				<div className="table-header">
					<div>
						<h3>
							{state === "all"
								? "All retained"
								: `${state[0].toUpperCase()}${state.slice(1)}`}{" "}
							tokens
							{tokensQuery.data?.total != null
								? ` (${tokensQuery.data.total})`
								: ""}
						</h3>
						<p className="muted">
							Select a token to inspect its scope and activity.
						</p>
					</div>
					<div className="table-tools">
						<button
							type="button"
							className="ghost"
							disabled={tokensQuery.isFetching}
							onClick={() => {
								void tokensQuery.refetch();
								void queryClient.invalidateQueries({
									queryKey: ["current-principal"],
								});
								void queryClient.invalidateQueries({
									queryKey: ["token-activity-summary"],
								});
							}}
						>
							Refresh overview
						</button>
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
				<div className="table-tools">
					<label className="control-field">
						<span>Token state</span>
						<select
							value={state}
							onChange={(event) => {
								const value = event.target.value;
								if (
									Object.values(TokenListState).some(
										(option) => option === value,
									)
								) {
									setState(value as TokenListState);
									setCursors([undefined]);
								}
							}}
						>
							<option value="active">Active</option>
							<option value="expired">Expired</option>
							<option value="revoked">Revoked</option>
							<option value="all">All retained</option>
						</select>
					</label>
					<label className="control-field">
						<span>Token order</span>
						<select
							value={sort}
							onChange={(event) => {
								setSort(event.target.value);
								setCursors([undefined]);
							}}
						>
							<option value="-issued_at">Newest issued</option>
							<option value="issued_at">Oldest issued</option>
							<option value="-last_used_at">Recently used</option>
						</select>
					</label>
					<label className="control-check">
						<input
							type="checkbox"
							checked={showActivity}
							onChange={(event) => setShowActivity(event.target.checked)}
						/>
						<span>Show activity overview</span>
					</label>
				</div>
				{showActivity ? (
					<p className="muted">
						Activity is loaded for this page only. Recorded sources are retained
						observations, not request counts or proof of inactivity. Collection
						may be incomplete; addresses may identify a proxy. Open a token for
						full coverage and source details.
					</p>
				) : null}
				{state !== "active" ? (
					<p className="muted">
						Expired and revoked subsets can overlap. Only retained tokens are
						available.
					</p>
				) : null}
				{tokensQuery.isFetching ? (
					<p role="status">Refreshing token overview…</p>
				) : null}
				{tokensQuery.isError ? (
					<p className="error-banner" role="alert">
						{tokensQuery.error.message} Use Refresh overview to retry.
					</p>
				) : null}

				{revokeMutation.isError ? (
					<div className="error-banner">
						{revokeMutation.error instanceof Error
							? revokeMutation.error.message
							: "Failed to revoke token."}
					</div>
				) : null}

				{tokensQuery.isLoading || tokensQuery.isError ? null : tokens.length ===
					0 ? (
					<div className="muted">
						No {state === "all" ? "retained" : state} tokens on this page.
					</div>
				) : (
					<section
						className="table-wrap"
						aria-label="Token overview table"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need keyboard access.
						tabIndex={0}
						onKeyDownCapture={(event) => {
							if (event.key === "ArrowLeft" || event.key === "ArrowRight")
								event.stopPropagation();
						}}
					>
						<table className="token-list-table" aria-label="Tokens">
							<thead>
								<tr>
									<th>ID</th>
									<th>Name</th>
									<th>Scope</th>
									<th>Issued</th>
									<th>Expires</th>
									<th>Last used</th>
									<th>Status</th>
									{showActivity ? <th>Activity overview</th> : null}
									<th />
								</tr>
							</thead>
							<tbody>
								{tokens.map((token) => {
									const lifecycleStatus = getTokenLifecycleStatus(token);
									const revoked = lifecycleStatus === "revoked";
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
												setSelection(token);
											}}
											onKeyDown={(event) => {
												if (
													event.currentTarget !== event.target ||
													(event.key !== "Enter" && event.key !== " ")
												) {
													return;
												}
												event.preventDefault();
												setSelection(token);
											}}
											aria-label={`View details for token ${token.id}${token.name ? ` ${token.name}` : ""}`}
										>
											<td>#{token.id}</td>
											<td>
												<div className="token-overview-cell">
													<strong>
														{token.name ??
															(token.id === currentToken?.id
																? "Web UI session"
																: "Unnamed token")}
													</strong>
													{token.id === currentToken?.id ? (
														<span className="badge">Current web session</span>
													) : null}
													{token.description ? (
														<span className="muted">{token.description}</span>
													) : null}
												</div>
											</td>
											<td>{formatTokenMetadataScope(token)}</td>
											<td>{formatTimestamp(token.issued)}</td>
											<td>
												{token.expires_at
													? formatTimestamp(token.expires_at)
													: "Server default lifetime"}
											</td>
											<td>
												{token.last_used_at
													? formatTimestamp(token.last_used_at)
													: "Not recorded"}
											</td>
											<td>{formatTokenLifecycleStatus(lifecycleStatus)}</td>
											{showActivity ? (
												<td>
													<TokenActivitySummary
														principalId={token.principal_id}
														tokenId={token.id}
													/>
												</td>
											) : null}
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
					</section>
				)}
				<TablePagination
					hasNextPage={Boolean(nextCursor)}
					hasPrevPage={cursors.length > 1}
					onNextPage={() => {
						if (nextCursor) setCursors([...cursors, nextCursor]);
					}}
					onPrevPage={() => setCursors(cursors.slice(0, -1))}
					onFirstPage={() => setCursors([undefined])}
					currentCount={tokens.length}
					totalCount={tokensQuery.data?.total}
					busy={tokensQuery.isFetching}
				/>
			</section>
		</>
	);
}
