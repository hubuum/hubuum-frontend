"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";

import { ScopePicker } from "@/components/scope-picker";
import { getApiErrorMessage } from "@/lib/api/errors";
import { postApiV1IamPrincipalsByPrincipalIdTokens } from "@/lib/api/generated/client";
import type {
	NewTokenRequest,
	Permissions,
	PrincipalToken,
} from "@/lib/api/generated/models";
import { canSubmitScopes, toScopesPayload } from "@/lib/token-scope-selection";

type TokenMintFormProps = {
	principalId: number;
	onMinted: (token: PrincipalToken) => void;
};

export function TokenMintForm({ principalId, onMinted }: TokenMintFormProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [expiresAt, setExpiresAt] = useState("");
	const [restrict, setRestrict] = useState(false);
	const [selected, setSelected] = useState<Permissions[]>([]);
	const [formError, setFormError] = useState<string | null>(null);

	const mintMutation = useMutation({
		mutationFn: async (payload: NewTokenRequest) => {
			const response = await postApiV1IamPrincipalsByPrincipalIdTokens(
				principalId,
				payload,
				{ credentials: "include" },
			);

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to create token."),
				);
			}

			// The 201 body is the raw token (not modeled in OpenAPI); the runtime
			// client parses it into `data`.
			return response.data as unknown as PrincipalToken;
		},
		onSuccess: async (token) => {
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", principalId],
			});
			setName("");
			setDescription("");
			setExpiresAt("");
			setRestrict(false);
			setSelected([]);
			setFormError(null);
			onMinted(token);
		},
		onError: (error) => {
			setFormError(
				error instanceof Error ? error.message : "Failed to create token.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);

		if (!canSubmitScopes(restrict, selected)) {
			setFormError("Select at least one scope, or turn off scope restriction.");
			return;
		}

		const payload: NewTokenRequest = {};
		const trimmedName = name.trim();
		const trimmedDescription = description.trim();
		if (trimmedName) {
			payload.name = trimmedName;
		}
		if (trimmedDescription) {
			payload.description = trimmedDescription;
		}
		if (expiresAt) {
			payload.expires_at = new Date(expiresAt).toISOString();
		}
		const scopes = toScopesPayload(restrict, selected);
		if (scopes) {
			payload.scopes = scopes;
		}

		mintMutation.mutate(payload);
	}

	return (
		<form className="card stack" onSubmit={onSubmit}>
			<h3>Create token</h3>

			<div className="form-grid">
				<label className="control-field">
					<span>Name (optional)</span>
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. ci-pipeline"
					/>
				</label>

				<label className="control-field">
					<span>Expires (optional)</span>
					<input
						type="datetime-local"
						value={expiresAt}
						onChange={(event) => setExpiresAt(event.target.value)}
					/>
				</label>

				<label className="control-field control-field--wide">
					<span>Description (optional)</span>
					<input
						value={description}
						onChange={(event) => setDescription(event.target.value)}
					/>
				</label>
			</div>

			<ScopePicker
				restrict={restrict}
				selected={selected}
				disabled={mintMutation.isPending}
				onChange={(nextRestrict, nextSelected) => {
					setRestrict(nextRestrict);
					setSelected(nextSelected);
				}}
			/>

			{formError ? <div className="error-banner">{formError}</div> : null}

			<div className="form-actions">
				<button type="submit" disabled={mintMutation.isPending}>
					{mintMutation.isPending ? "Creating..." : "Create token"}
				</button>
			</div>
		</form>
	);
}
