"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import { ScopePicker } from "@/components/scope-picker";
import { TokenResourceScopePicker } from "@/components/token-resource-scope-picker";
import { getApiErrorMessage } from "@/lib/api/errors";
import { postApiV1IamPrincipalsByPrincipalIdTokens } from "@/lib/api/generated/client";
import type {
	LoginResponse,
	NewTokenRequest,
	Permissions,
} from "@/lib/api/generated/models";
import { toNaiveDateTimePayload } from "@/lib/naive-datetime";
import {
	canSubmitResourceScopes,
	countResourceScopesByKind,
	type NamedTokenResourceScope,
} from "@/lib/token-resource-scope-selection";
import { canSubmitScopes } from "@/lib/token-scope-selection";
import { toTokenScopeRequest } from "@/lib/token-scope-request";
import { READ_ONLY_TOKEN_SCOPES } from "@/lib/token-scopes";

type TokenMintFormProps = {
	principalId: number;
	onMinted: (token: LoginResponse) => void;
};

const TOKEN_STEPS = [
	{ id: "details", label: "Details", hint: "Purpose and expiry" },
	{
		id: "permissions",
		label: "Permission scope",
		hint: "Choose allowed operations",
	},
	{
		id: "resources",
		label: "Resource scope",
		hint: "Choose resources by name",
	},
	{ id: "review", label: "Review", hint: "Confirm and create" },
] as const;

type TokenStep = (typeof TOKEN_STEPS)[number]["id"];
type TokenPermissionMode = "all" | "read_only" | "custom";
type TokenResourceMode = "all" | "specific";

function selectedResourceSummary(selected: NamedTokenResourceScope[]): string {
	const counts = countResourceScopesByKind(selected);
	const parts = (
		[
			["collection", counts.collection],
			["class", counts.class],
			["object", counts.object],
		] as const
	)
		.filter(([, count]) => count > 0)
		.map(
			([kind, count]) =>
				`${count} ${kind}${count === 1 ? "" : kind === "class" ? "es" : "s"}`,
		);
	return parts.join(", ");
}

export function TokenMintForm({ principalId, onMinted }: TokenMintFormProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [expiresAt, setExpiresAt] = useState("");
	const [permissionMode, setPermissionMode] =
		useState<TokenPermissionMode>("read_only");
	const [selectedPermissions, setSelectedPermissions] = useState<Permissions[]>(
		[],
	);
	const [resourceMode, setResourceMode] =
		useState<TokenResourceMode>("specific");
	const [selectedResources, setSelectedResources] = useState<
		NamedTokenResourceScope[]
	>([]);
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

			return response.data;
		},
		onSuccess: async (token) => {
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", principalId],
			});
			setName("");
			setDescription("");
			setExpiresAt("");
			setPermissionMode("read_only");
			setSelectedPermissions([]);
			setResourceMode("specific");
			setSelectedResources([]);
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

	const effectivePermissions =
		permissionMode === "read_only"
			? READ_ONLY_TOKEN_SCOPES
			: permissionMode === "custom"
				? selectedPermissions
				: [];
	const restrictPermissions = permissionMode !== "all";
	const restrictResources = resourceMode === "specific";
	const permissionsReady = canSubmitScopes(
		restrictPermissions,
		effectivePermissions,
	);
	const resourcesReady = canSubmitResourceScopes(
		restrictResources,
		selectedResources,
	);
	const permissionSummary =
		permissionMode === "all"
			? "All permissions held by the principal"
			: permissionMode === "read_only"
				? `${READ_ONLY_TOKEN_SCOPES.length} read-only permissions`
				: `${selectedPermissions.length} custom permission${selectedPermissions.length === 1 ? "" : "s"}`;
	const resourceSummary =
		resourceMode === "all"
			? "All resources authorized for the principal"
			: selectedResources.length > 0
				? selectedResourceSummary(selectedResources)
				: "No resources selected";
	const tokenSteps = TOKEN_STEPS.map((step) => ({
		...step,
		enabled:
			step.id === "details" ||
			step.id === "permissions" ||
			(step.id === "resources" && permissionsReady) ||
			(step.id === "review" && permissionsReady && resourcesReady),
	}));

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);

		if (!permissionsReady) {
			setFormError("Select at least one custom permission.");
			setActiveStep("permissions");
			return;
		}
		if (!resourcesReady) {
			setFormError("Select at least one resource, or allow all resources.");
			setActiveStep("resources");
			return;
		}
		if (activeStep !== "review") {
			setActiveStep("review");
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
			const normalizedExpiresAt = toNaiveDateTimePayload(expiresAt);
			if (!normalizedExpiresAt) {
				setFormError("Enter a valid token expiration date and time.");
				setActiveStep("details");
				return;
			}
			payload.expires_at = normalizedExpiresAt;
		}
		Object.assign(
			payload,
			toTokenScopeRequest({
				permissions: effectivePermissions,
				resources: selectedResources,
				restrictPermissions,
				restrictResources,
			}),
		);

		mintMutation.mutate(payload);
	}

	return (
		<form className="card stack" onSubmit={onSubmit}>
			<h3>Create token</h3>
			<p className="muted">
				Permission and resource scopes independently narrow the principal&apos;s
				live group grants. Neither scope can add authority.
			</p>

			<GuidedFlowTabs
				activeStep={activeStep}
				ariaLabel="Token creation steps"
				idPrefix="token-create"
				onChange={(step) => {
					setFormError(null);
					setActiveStep(step);
				}}
				steps={tokenSteps}
			/>

			{activeStep === "details" ? (
				<GuidedFlowPanel idPrefix="token-create" stepId="details">
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
						nextLabel="Permission scope"
						onContinue={() => setActiveStep("permissions")}
						summary={
							expiresAt
								? `Expires ${new Date(expiresAt).toLocaleString()}`
								: "Uses the server's default token lifetime"
						}
						title="Token details ready"
					/>
				</GuidedFlowPanel>
			) : null}

			{activeStep === "permissions" ? (
				<GuidedFlowPanel idPrefix="token-create" stepId="permissions">
					<div className="segmented-options token-access-picker">
						<button
							type="button"
							className={
								permissionMode === "read_only" ? "is-selected" : "ghost"
							}
							aria-pressed={permissionMode === "read_only"}
							onClick={() => {
								setPermissionMode("read_only");
								setFormError(null);
							}}
						>
							<span>Read only</span>
							<small>Use the explicit read-permission preset</small>
						</button>
						<button
							type="button"
							className={permissionMode === "custom" ? "is-selected" : "ghost"}
							aria-pressed={permissionMode === "custom"}
							onClick={() => {
								setPermissionMode("custom");
								setFormError(null);
							}}
						>
							<span>Custom permissions</span>
							<small>Select only the operations this token needs</small>
						</button>
						<button
							type="button"
							className={permissionMode === "all" ? "is-selected" : "ghost"}
							aria-pressed={permissionMode === "all"}
							onClick={() => {
								setPermissionMode("all");
								setFormError(null);
							}}
						>
							<span>All permissions</span>
							<small>Do not restrict the permission dimension</small>
						</button>
					</div>
					{permissionMode === "custom" ? (
						<ScopePicker
							restrict
							selected={selectedPermissions}
							disabled={mintMutation.isPending}
							showRestrictionToggle={false}
							onChange={(_, nextSelected) => {
								setSelectedPermissions(nextSelected);
								setFormError(null);
							}}
						/>
					) : permissionMode === "all" ? (
						<div className="warning-banner">
							The permission dimension will be unrestricted. The resource scope
							can still narrow where this token acts.
						</div>
					) : (
						<div className="info-banner">
							The preset includes explicit read permissions only—no create,
							update, delete, delegation, execution, or subscription management.
						</div>
					)}
					<GuidedFlowContinue
						disabled={!permissionsReady}
						nextLabel="Resource scope"
						onBack={() => setActiveStep("details")}
						onContinue={() => {
							if (permissionsReady) {
								setFormError(null);
								setActiveStep("resources");
							} else {
								setFormError("Select at least one custom permission.");
							}
						}}
						summary={permissionSummary}
						title={
							permissionsReady
								? "Permission scope ready"
								: "Choose at least one custom permission"
						}
					/>
				</GuidedFlowPanel>
			) : null}

			{activeStep === "resources" ? (
				<GuidedFlowPanel idPrefix="token-create" stepId="resources">
					<div className="segmented-options token-access-picker">
						<button
							type="button"
							className={resourceMode === "specific" ? "is-selected" : "ghost"}
							aria-pressed={resourceMode === "specific"}
							onClick={() => {
								setResourceMode("specific");
								setFormError(null);
							}}
						>
							<span>Specific resources</span>
							<small>Find collections, classes, or objects by name</small>
						</button>
						<button
							type="button"
							className={resourceMode === "all" ? "is-selected" : "ghost"}
							aria-pressed={resourceMode === "all"}
							onClick={() => {
								setResourceMode("all");
								setFormError(null);
							}}
						>
							<span>All resources</span>
							<small>Do not restrict the resource dimension</small>
						</button>
					</div>
					{resourceMode === "specific" ? (
						<TokenResourceScopePicker
							selected={selectedResources}
							disabled={mintMutation.isPending}
							onChange={(nextSelected) => {
								setSelectedResources(nextSelected);
								setFormError(null);
							}}
						/>
					) : (
						<div className="warning-banner">
							The resource dimension will be unrestricted. Live group grants
							still determine which resources the principal can access.
						</div>
					)}
					<GuidedFlowContinue
						disabled={!resourcesReady}
						nextLabel="Review"
						onBack={() => setActiveStep("permissions")}
						onContinue={() => {
							if (resourcesReady) {
								setFormError(null);
								setActiveStep("review");
							} else {
								setFormError(
									"Select at least one resource, or allow all resources.",
								);
							}
						}}
						summary={resourceSummary}
						title={
							resourcesReady
								? "Resource scope ready"
								: "Choose at least one named resource"
						}
					/>
				</GuidedFlowPanel>
			) : null}

			{activeStep === "review" ? (
				<GuidedFlowPanel idPrefix="token-create" stepId="review">
					<div className="info-banner">
						Effective authority = live principal/group grants ∩ permission scope
						∩ resource scope.
					</div>
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
									: "Server default token lifetime"}
							</dd>
						</div>
						<div>
							<dt>Permission scope</dt>
							<dd>{permissionSummary}</dd>
						</div>
						{permissionMode !== "all" ? (
							<div>
								<dt>Permissions</dt>
								<dd>{effectivePermissions.join(", ")}</dd>
							</div>
						) : null}
						<div>
							<dt>Resource scope</dt>
							<dd>{resourceSummary}</dd>
						</div>
						{resourceMode === "specific" ? (
							<div>
								<dt>Resources</dt>
								<dd>
									{selectedResources.map((scope) => scope.label).join(", ")}
								</dd>
							</div>
						) : null}
					</dl>
					{permissionMode === "all" && resourceMode === "all" ? (
						<div className="warning-banner">
							Both dimensions are unrestricted. This creates an unscoped token
							with the principal&apos;s full current authority.
						</div>
					) : null}
					<div className="form-actions">
						<button
							type="button"
							className="ghost"
							onClick={() => setActiveStep("resources")}
							disabled={mintMutation.isPending}
						>
							Back
						</button>
						<button
							type="submit"
							disabled={
								mintMutation.isPending || !permissionsReady || !resourcesReady
							}
						>
							{mintMutation.isPending ? "Creating..." : "Create token"}
						</button>
					</div>
				</GuidedFlowPanel>
			) : null}

			{formError ? (
				<div className="error-banner" role="alert">
					{formError}
				</div>
			) : null}
		</form>
	);
}
