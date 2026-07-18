"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";

import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import { ScopePicker } from "@/components/scope-picker";
import { getApiErrorMessage } from "@/lib/api/errors";
import { postApiV1IamPrincipalsByPrincipalIdTokens } from "@/lib/api/generated/client";
import type {
	NewTokenRequest,
	Permissions,
	PrincipalToken,
} from "@/lib/api/generated/models";
import { canSubmitScopes, toScopesPayload } from "@/lib/token-scope-selection";
import { READ_ONLY_TOKEN_SCOPES } from "@/lib/token-scopes";

type TokenMintFormProps = {
	principalId: number;
	onMinted: (token: PrincipalToken) => void;
};

const TOKEN_STEPS = [
	{ id: "details", label: "Details", hint: "Purpose and expiry" },
	{ id: "access", label: "Access", hint: "Choose authority" },
	{ id: "review", label: "Review", hint: "Confirm and create" },
] as const;

type TokenStep = (typeof TOKEN_STEPS)[number]["id"];
type TokenAccessMode = "full" | "read_only" | "custom";

export function TokenMintForm({ principalId, onMinted }: TokenMintFormProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [expiresAt, setExpiresAt] = useState("");
	const [accessMode, setAccessMode] = useState<TokenAccessMode>("read_only");
	const [selected, setSelected] = useState<Permissions[]>([]);
	const [formError, setFormError] = useState<string | null>(null);
	const [activeStep, setActiveStep] = useState<TokenStep>("details");

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
			setAccessMode("read_only");
			setSelected([]);
			setFormError(null);
			setActiveStep("details");
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

		const restrict = accessMode !== "full";
		const effectiveSelected =
			accessMode === "read_only" ? READ_ONLY_TOKEN_SCOPES : selected;
		if (!canSubmitScopes(restrict, effectiveSelected)) {
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
		const scopes = toScopesPayload(restrict, effectiveSelected);
		if (scopes) {
			payload.scopes = scopes;
		}

		mintMutation.mutate(payload);
	}

	const effectiveSelected =
		accessMode === "read_only"
			? READ_ONLY_TOKEN_SCOPES
			: accessMode === "custom"
				? selected
				: [];
	const accessReady = accessMode !== "custom" || selected.length > 0;
	const tokenSteps = TOKEN_STEPS.map((step) => ({
		...step,
		enabled: step.id !== "review" || accessReady,
	}));
	const accessSummary =
		accessMode === "full"
			? "Full principal authority"
			: accessMode === "read_only"
				? `${READ_ONLY_TOKEN_SCOPES.length} read-only permissions`
				: `${selected.length} custom permission${selected.length === 1 ? "" : "s"}`;

	return (
		<form className="card stack" onSubmit={onSubmit}>
			<h3>Create token</h3>
			<p className="muted">
				Describe the token, choose the smallest useful authority, and review it
				before the one-time secret is created.
			</p>

			<GuidedFlowTabs
				activeStep={activeStep}
				ariaLabel="Token creation steps"
				onChange={(step) => {
					setFormError(null);
					setActiveStep(step);
				}}
				steps={tokenSteps}
			/>

			{activeStep === "details" ? (
				<GuidedFlowPanel stepId="details">
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
								placeholder="What will use this token?"
							/>
						</label>
					</div>
					<GuidedFlowContinue
						nextLabel="Access"
						onContinue={() => setActiveStep("access")}
						summary={
							expiresAt
								? `Expires ${new Date(expiresAt).toLocaleString()}`
								: "No expiration configured"
						}
						title="Token details ready"
					/>
				</GuidedFlowPanel>
			) : null}

			{activeStep === "access" ? (
				<GuidedFlowPanel stepId="access">
					<div className="segmented-options token-access-picker">
						<button
							type="button"
							className={accessMode === "read_only" ? "is-selected" : "ghost"}
							aria-pressed={accessMode === "read_only"}
							onClick={() => {
								setAccessMode("read_only");
								setFormError(null);
							}}
						>
							<span>Read only</span>
							<small>
								Collections, data, relations, templates, targets, and audit
							</small>
						</button>
						<button
							type="button"
							className={accessMode === "custom" ? "is-selected" : "ghost"}
							aria-pressed={accessMode === "custom"}
							onClick={() => {
								setAccessMode("custom");
								setFormError(null);
							}}
						>
							<span>Custom permissions</span>
							<small>Select only the operations this token needs</small>
						</button>
						<button
							type="button"
							className={accessMode === "full" ? "is-selected" : "ghost"}
							aria-pressed={accessMode === "full"}
							onClick={() => {
								setAccessMode("full");
								setFormError(null);
							}}
						>
							<span>Full authority</span>
							<small>Inherit all authority held by this principal</small>
						</button>
					</div>
					{accessMode === "custom" ? (
						<ScopePicker
							restrict
							selected={selected}
							disabled={mintMutation.isPending}
							showRestrictionToggle={false}
							onChange={(_, nextSelected) => {
								setSelected(nextSelected);
								setFormError(null);
							}}
						/>
					) : accessMode === "full" ? (
						<div className="warning-banner">
							This unscoped token will carry the principal&apos;s full current
							authority.
						</div>
					) : (
						<div className="info-banner">
							The read-only preset grants eight explicit read permissions and no
							create, update, delete, delegation, execution, or
							subscription-management permissions.
						</div>
					)}
					<GuidedFlowContinue
						disabled={!accessReady}
						nextLabel="Review"
						onBack={() => setActiveStep("details")}
						onContinue={() => {
							if (accessReady) {
								setFormError(null);
								setActiveStep("review");
							} else {
								setFormError("Select at least one custom permission.");
							}
						}}
						summary={accessSummary}
						title={
							accessReady
								? "Authority ready"
								: "Choose at least one custom permission"
						}
					/>
				</GuidedFlowPanel>
			) : null}

			{activeStep === "review" ? (
				<GuidedFlowPanel stepId="review">
					<dl className="guided-flow-review-list">
						<div>
							<dt>Purpose</dt>
							<dd>
								{name.trim() || "Unnamed token"}
								{description.trim() ? ` · ${description.trim()}` : ""}
							</dd>
						</div>
						<div>
							<dt>Expiration</dt>
							<dd>
								{expiresAt
									? new Date(expiresAt).toLocaleString()
									: "Does not expire"}
							</dd>
						</div>
						<div>
							<dt>Authority</dt>
							<dd>{accessSummary}</dd>
						</div>
						{accessMode !== "full" ? (
							<div>
								<dt>Permissions</dt>
								<dd>{effectiveSelected.join(", ")}</dd>
							</div>
						) : null}
					</dl>
					{accessMode === "full" ? (
						<div className="warning-banner">
							Confirm that full principal authority is required before creating
							this token.
						</div>
					) : null}
					<div className="form-actions">
						<button
							type="button"
							className="ghost"
							onClick={() => setActiveStep("access")}
							disabled={mintMutation.isPending}
						>
							Back
						</button>
						<button
							type="submit"
							disabled={mintMutation.isPending || !accessReady}
						>
							{mintMutation.isPending ? "Creating..." : "Create token"}
						</button>
					</div>
				</GuidedFlowPanel>
			) : null}

			{formError ? <div className="error-banner">{formError}</div> : null}
		</form>
	);
}
