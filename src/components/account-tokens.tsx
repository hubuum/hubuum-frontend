"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { TokenCreationModal } from "@/components/token-creation-modal";
import { TokenList } from "@/components/token-list";
import { useCurrentUserId } from "@/lib/use-current-user-id";

type AccountTokensProps = {
	currentUsername: string | null;
};

export function AccountTokens({ currentUsername }: AccountTokensProps) {
	const queryClient = useQueryClient();
	const principalId = useCurrentUserId(currentUsername);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);

	if (principalId == null) {
		return <div className="card muted">Resolving your account…</div>;
	}

	return (
		<div className="stack">
			<TokenCreationModal
				open={isCreateModalOpen}
				principalId={principalId}
				onClose={() => setCreateModalOpen(false)}
				onMinted={() => {
					void queryClient.invalidateQueries({
						queryKey: ["principal-tokens", "me"],
					});
				}}
			/>
			<TokenList
				principalId="me"
				onCreate={() => setCreateModalOpen(true)}
			/>
		</div>
	);
}
