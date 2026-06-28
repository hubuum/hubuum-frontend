"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { RawTokenReveal } from "@/components/raw-token-reveal";
import { TokenList } from "@/components/token-list";
import { TokenMintForm } from "@/components/token-mint-form";
import { useCurrentUserId } from "@/lib/use-current-user-id";

type AccountTokensProps = {
	currentUsername: string | null;
};

export function AccountTokens({ currentUsername }: AccountTokensProps) {
	const queryClient = useQueryClient();
	const principalId = useCurrentUserId(currentUsername);
	const [rawToken, setRawToken] = useState<string | null>(null);

	if (principalId == null) {
		return <div className="card muted">Resolving your account…</div>;
	}

	return (
		<div className="stack">
			{rawToken ? (
				<RawTokenReveal token={rawToken} onDismiss={() => setRawToken(null)} />
			) : null}
			<TokenMintForm
				principalId={principalId}
				onMinted={(token) => {
					setRawToken(token.token);
					void queryClient.invalidateQueries({
						queryKey: ["principal-tokens", "me"],
					});
				}}
			/>
			<TokenList principalId="me" />
		</div>
	);
}
