"use client";

import { useEffect, useState } from "react";

import { CreateModal } from "@/components/create-modal";
import { RawTokenReveal } from "@/components/raw-token-reveal";
import { TokenMintForm } from "@/components/token-mint-form";
import type { LoginResponse } from "@/lib/api/generated/models";
import type { TokenMintInitialValues } from "@/lib/token-clone";

type TokenCreationModalProps = {
	initialValues?: TokenMintInitialValues;
	open: boolean;
	principalId: number;
	onClose: () => void;
	onMinted?: (token: LoginResponse) => void;
};

export function TokenCreationModal({
	initialValues,
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
			title={
				initialValues
					? `Clone token #${initialValues.sourceTokenId}`
					: "Create token"
			}
			closeDisabled={formCloseLocked || rawToken !== null}
			onClose={onClose}
		>
			{rawToken ? (
				<RawTokenReveal token={rawToken} onDismiss={finish} />
			) : (
				<TokenMintForm
					embedded
					initialValues={initialValues}
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
