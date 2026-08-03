"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { TokenCreationModal } from "@/components/token-creation-modal";
import { TokenList } from "@/components/token-list";
import {
	toTokenMintInitialValues,
	type TokenMintInitialValues,
} from "@/lib/token-clone";
import {
	getTokenMintAccess,
	type TokenMintAuthority,
} from "@/lib/token-mint-access";
import { useCurrentPrincipal } from "@/lib/use-current-principal";

type PrincipalTokenManagerProps = {
	authority: TokenMintAuthority;
	listPrincipalId?: number | "me";
	principalId?: number;
	targetDisabled?: boolean;
	targetKind: "human" | "service_account";
};

export function PrincipalTokenManager({
	authority,
	listPrincipalId,
	principalId,
	targetDisabled = false,
	targetKind,
}: PrincipalTokenManagerProps) {
	const queryClient = useQueryClient();
	const currentPrincipalQuery = useCurrentPrincipal();
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const [cloneInitialValues, setCloneInitialValues] =
		useState<TokenMintInitialValues>();
	const actor = currentPrincipalQuery.data;
	const targetPrincipalId =
		principalId ??
		(authority === "self" ? actor?.principal.principal_id : undefined);
	const resolvedListPrincipalId = listPrincipalId ?? targetPrincipalId;
	const mintAccess = actor
		? getTokenMintAccess({
				actorKind: actor.principal.kind,
				actorPrincipalId: actor.principal.principal_id,
				authority,
				currentTokenScoped: actor.token.scope != null,
				targetDisabled,
				targetKind,
				targetPrincipalId,
			})
		: null;
	const canMint = mintAccess?.allowed === true && targetPrincipalId != null;

	return (
		<div className="stack">
			{targetPrincipalId != null ? (
				<TokenCreationModal
					initialValues={cloneInitialValues}
					open={isCreateModalOpen && canMint}
					principalId={targetPrincipalId}
					onClose={() => {
						setCreateModalOpen(false);
						setCloneInitialValues(undefined);
					}}
					onMinted={() => {
						if (resolvedListPrincipalId != null) {
							void queryClient.invalidateQueries({
								queryKey: ["principal-tokens", resolvedListPrincipalId],
							});
						}
					}}
				/>
			) : null}
			{resolvedListPrincipalId != null ? (
				<TokenList
					principalId={resolvedListPrincipalId}
					onClone={
						canMint
							? (token, resourceNames) => {
									setCloneInitialValues(
										toTokenMintInitialValues(token, resourceNames),
									);
									setCreateModalOpen(true);
								}
							: undefined
					}
					onCreate={
						canMint
							? () => {
									setCloneInitialValues(undefined);
									setCreateModalOpen(true);
								}
							: undefined
					}
				/>
			) : (
				<div className="card muted">Resolving the token owner…</div>
			)}
			{currentPrincipalQuery.isLoading ? (
				<div className="muted">Checking token creation access…</div>
			) : currentPrincipalQuery.isError ? (
				<div className="error-banner">
					{currentPrincipalQuery.error instanceof Error
						? currentPrincipalQuery.error.message
						: "Could not verify token creation access."}
				</div>
			) : mintAccess && !mintAccess.allowed ? (
				<div className="muted">{mintAccess.reason}</div>
			) : null}
		</div>
	);
}
