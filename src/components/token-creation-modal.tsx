"use client";

import { useEffect, useState } from "react";

import { CreateModal } from "@/components/create-modal";
import { RawTokenReveal } from "@/components/raw-token-reveal";
import { TokenMintForm } from "@/components/token-mint-form";
import type { LoginResponse } from "@/lib/api/generated/models";

type TokenCreationModalProps = {
	open: boolean;
	principalId: number;
	onClose: () => void;
	onMinted?: (token: LoginResponse) => void;
};

export function TokenCreationModal({
	open,
	principalId,
	onClose,
	onMinted,
}: TokenCreationModalProps) {
	const [formCloseLocked, setFormCloseLocked] = useState(false);
	const [rawToken, setRawToken] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			return;
		}
		setFormCloseLocked(false);
		setRawToken(null);
	}, [open]);

	function finish() {
		setRawToken(null);
		onClose();
	}

	return (
		<CreateModal
			open={open}
			title="Create token"
			closeDisabled={formCloseLocked || rawToken !== null}
			onClose={onClose}
		>
			{rawToken ? (
				<RawTokenReveal token={rawToken} onDismiss={finish} />
			) : (
				<TokenMintForm
					embedded
					principalId={principalId}
					onCloseLockedChange={setFormCloseLocked}
					onMinted={(token) => {
						setRawToken(token.token);
						onMinted?.(token);
					}}
				/>
			)}
		</CreateModal>
	);
}
