"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import { RawTokenReveal } from "@/components/raw-token-reveal";
import { ScopePicker } from "@/components/scope-picker";
import { TokenResourceScopePicker } from "@/components/token-resource-scope-picker";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	postApiV1IamPrincipalsByPrincipalIdTokens,
	postApiV1IamServiceAccounts,
} from "@/lib/api/generated/client";
import type {
	NewServiceAccount,
	NewTokenRequest,
	Permissions,
	ServiceAccountResponse,
} from "@/lib/api/generated/models";
import {
	type ConsoleGroup,
	formatScopedGroupName,
} from "@/lib/identity-scopes";
import { toNaiveDateTimePayload } from "@/lib/naive-datetime";
import {
	canSubmitResourceScopes,
	countResourceScopesByKind,
	type NamedTokenResourceScope,
} from "@/lib/token-resource-scope-selection";
import { canSubmitScopes } from "@/lib/token-scope-selection";
import { toTokenScopeRequest } from "@/lib/token-scope-request";
import { READ_ONLY_TOKEN_SCOPES } from "@/lib/token-scopes";

type ServiceAccountCreateFlowProps = {
	groups: ConsoleGroup[];
	groupsError: boolean;
	groupsLoading: boolean;
	onCloseLockedChange: (locked: boolean) => void;
	onFinished: (account: ServiceAccountResponse) => void;
	open: boolean;
};

const CREATE_STEPS = [
	{ id: "details", label: "Account", hint: "Identity and initial token" },
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

type CreateStep = (typeof CREATE_STEPS)[number]["id"];
type PermissionMode = "all" | "read_only" | "custom";
type ResourceMode = "all" | "specific";

class InitialTokenError extends Error {
	account: ServiceAccountResponse;

	constructor(account: ServiceAccountResponse, message: string) {
		super(message);
		this.account = account;
	}
}

function resourceSummary(selected: NamedTokenResourceScope[]): string {
	const counts = countResourceScopesByKind(selected);
	return (
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
		)
		.join(", ");
}

export function ServiceAccountCreateFlow({
	groups,
	groupsError,
	groupsLoading,
	onCloseLockedChange,
	onFinished,
	open,
}: ServiceAccountCreateFlowProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [ownerGroupId, setOwnerGroupId] = useState("");
	const [tokenName, setTokenName] = useState("initial");
	const [expiresAt, setExpiresAt] = useState("");
	const [permissionMode, setPermissionMode] =
		useState<PermissionMode>("read_only");
	const [selectedPermissions, setSelectedPermissions] = useState<Permissions[]>(
		[],
	);
	const [resourceMode, setResourceMode] = useState<ResourceMode>("specific");
	const [selectedResources, setSelectedResources] = useState<
		NamedTokenResourceScope[]
	>([]);
	const [activeStep, setActiveStep] = useState<CreateStep>("details");
	const [formError, setFormError] = useState<string | null>(null);
	const [createdAccount, setCreatedAccount] =
		useState<ServiceAccountResponse | null>(null);
	const [rawToken, setRawToken] = useState<string | null>(null);

	const reset = useCallback(() => {
		setName("");
		setDescription("");
		setOwnerGroupId("");
		setTokenName("initial");
		setExpiresAt("");
		setPermissionMode("read_only");
		setSelectedPermissions([]);
		setResourceMode("specific");
		setSelectedResources([]);
		setActiveStep("details");
		setFormError(null);
		setCreatedAccount(null);
		setRawToken(null);
	}, []);

	useEffect(() => {
		if (!open) {
			reset();
		}
	}, [open, reset]);

	useEffect(() => {
		if (ownerGroupId || groups.length === 0) {
			return;
		}
		setOwnerGroupId(String(groups[0].id));
	}, [groups, ownerGroupId]);

	const effectivePermissions =
		permissionMode === "read_only"
			? READ_ONLY_TOKEN_SCOPES
			: permissionMode === "custom"
				? selectedPermissions
				: [];
	const restrictPermissions = permissionMode !== "all";
	const restrictResources = resourceMode === "specific";
	const detailsReady =
		Boolean(name.trim()) && Number.isFinite(Number.parseInt(ownerGroupId, 10));
	const permissionsReady = canSubmitScopes(
		restrictPermissions,
		effectivePermissions,
	);
	const resourcesReady = canSubmitResourceScopes(
		restrictResources,
		selectedResources,
	);
	const selectedOwner = groups.find(
		(group) => group.id === Number.parseInt(ownerGroupId, 10),
	);
	const permissionSummary =
		permissionMode === "all"
			? "All permissions held by the principal"
			: permissionMode === "read_only"
				? `${READ_ONLY_TOKEN_SCOPES.length} read-only permissions`
				: `${selectedPermissions.length} custom permission${selectedPermissions.length === 1 ? "" : "s"}`;
	const selectedResourceSummary =
		resourceMode === "all"
			? "All resources authorized for the principal"
			: selectedResources.length > 0
				? resourceSummary(selectedResources)
				: "No resources selected";
	const steps = CREATE_STEPS.map((step) => ({
		...step,
		enabled:
			(!createdAccount && step.id === "details") ||
			(step.id === "permissions" && detailsReady) ||
			(step.id === "resources" && detailsReady && permissionsReady) ||
			(step.id === "review" &&
				detailsReady &&
				permissionsReady &&
				resourcesReady),
	}));

	function buildTokenPayload(): NewTokenRequest {
		const payload: NewTokenRequest = {
			name: tokenName.trim() || "initial",
			description: `Initial token for ${name.trim()}`,
		};
		if (expiresAt) {
			const normalizedExpiresAt = toNaiveDateTimePayload(expiresAt);
			if (!normalizedExpiresAt) {
				throw new Error(
					"Enter a valid initial token expiration date and time.",
				);
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
		return payload;
	}

	const createMutation = useMutation({
		mutationFn: async () => {
			const tokenPayload = buildTokenPayload();
			let account = createdAccount;
			if (!account) {
				const accountPayload: NewServiceAccount = {
					name: name.trim(),
					owner_group_id: Number.parseInt(ownerGroupId, 10),
				};
				if (description.trim()) {
					accountPayload.description = description.trim();
				}
				const accountResponse = await postApiV1IamServiceAccounts(
					accountPayload,
					{ credentials: "include" },
				);
				if (accountResponse.status !== 201) {
					throw new Error(
						getApiErrorMessage(
							accountResponse.data,
							"Failed to create service account.",
						),
					);
				}
				account = accountResponse.data;
			}

			let tokenResponse: Awaited<
				ReturnType<typeof postApiV1IamPrincipalsByPrincipalIdTokens>
			>;
			try {
				tokenResponse = await postApiV1IamPrincipalsByPrincipalIdTokens(
					account.id,
					tokenPayload,
					{ credentials: "include" },
				);
			} catch {
				throw new InitialTokenError(
					account,
					"The token request could not be confirmed. Check the account's token list and revoke any unknown token before retrying.",
				);
			}
			if (tokenResponse.status !== 201) {
				throw new InitialTokenError(
					account,
					getApiErrorMessage(
						tokenResponse.data,
						"Failed to create the initial token.",
					),
				);
			}

			return { account, token: tokenResponse.data.token };
		},
		onSuccess: async ({ account, token }) => {
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", account.id],
			});
			setCreatedAccount(account);
			setRawToken(token);
			setFormError(null);
		},
		onError: async (error) => {
			if (error instanceof InitialTokenError) {
				setCreatedAccount(error.account);
				await queryClient.invalidateQueries({
					queryKey: ["service-accounts"],
				});
				setFormError(
					`Service account #${error.account.id} was created, but its initial token is not available: ${error.message} Review the scopes and retry the token without recreating the account.`,
				);
				setActiveStep("review");
				return;
			}
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to create service account.",
			);
		},
	});

	useEffect(() => {
		onCloseLockedChange(createMutation.isPending || Boolean(rawToken));
		return () => onCloseLockedChange(false);
	}, [createMutation.isPending, onCloseLockedChange, rawToken]);

	function finish() {
		if (!createdAccount) {
			return;
		}
		const account = createdAccount;
		reset();
		onFinished(account);
	}

	if (createdAccount && rawToken) {
		return (
			<div className="stack">
				<div className="info-banner">
					Service account <strong>{createdAccount.name}</strong> (#
					{createdAccount.id}) and its scoped initial token are ready. Copy the
					token before continuing; runtime access also requires live group
					membership.
				</div>
				<RawTokenReveal token={rawToken} onDismiss={finish} />
			</div>
		);
	}

	return (
		<form
			className="stack"
			onSubmit={(event) => {
				event.preventDefault();
				setFormError(null);
				if (!detailsReady) {
					setFormError("Name and owner group are required.");
					setActiveStep("details");
					return;
				}
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
				createMutation.mutate();
			}}
		>
			<p className="muted">
				Create the non-human principal and its first token together. The
				token&apos;s two scope dimensions can only narrow the account&apos;s
				live group authority.
			</p>
			<GuidedFlowTabs
				activeStep={activeStep}
				ariaLabel="Service account creation steps"
				idPrefix="service-account-create"
				onChange={(step) => {
					setFormError(null);
					setActiveStep(step);
				}}
				steps={steps}
			/>

			{activeStep === "details" ? (
				<GuidedFlowPanel idPrefix="service-account-create" stepId="details">
					<div className="info-banner">
						The owner group controls who may manage this account; it does not
						grant runtime collection access.
					</div>
					<div className="form-grid">
						<label className="control-field">
							<span>Service account name</span>
							<input
								required
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="e.g. dns-sync"
							/>
						</label>
						<label className="control-field">
							<span>Owner group</span>
							<select
								required
								value={ownerGroupId}
								onChange={(event) => setOwnerGroupId(event.target.value)}
								disabled={groupsLoading || groups.length === 0}
							>
								{groupsLoading ? (
									<option value="">Loading groups...</option>
								) : null}
								{!groupsLoading && groups.length === 0 ? (
									<option value="">No groups available</option>
								) : null}
								{groups.map((group) => (
									<option key={group.id} value={group.id}>
										{formatScopedGroupName(group)} (#{group.id})
									</option>
								))}
							</select>
						</label>
						<label className="control-field control-field--wide">
							<span>Description (optional)</span>
							<input
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								placeholder="What automation will use this account?"
							/>
						</label>
						<label className="control-field">
							<span>Initial token name</span>
							<input
								value={tokenName}
								onChange={(event) => setTokenName(event.target.value)}
							/>
						</label>
						<label className="control-field">
							<span>Initial token expires (optional)</span>
							<input
								type="datetime-local"
								value={expiresAt}
								onChange={(event) => setExpiresAt(event.target.value)}
							/>
						</label>
					</div>
					{groupsError ? (
						<div className="error-banner">
							Failed to load owner groups. Reload before creating a service
							account.
						</div>
					) : null}
					<GuidedFlowContinue
						disabled={!detailsReady}
						nextLabel="Permission scope"
						onContinue={() => {
							if (detailsReady) {
								setActiveStep("permissions");
							} else {
								setFormError("Name and owner group are required.");
							}
						}}
						summary={
							detailsReady
								? `${name.trim()} · ${selectedOwner ? formatScopedGroupName(selectedOwner) : "owner group"}`
								: "Name and owner group are required"
						}
						title={
							detailsReady ? "Account details ready" : "Complete the account"
						}
					/>
				</GuidedFlowPanel>
			) : null}

			{activeStep === "permissions" ? (
				<GuidedFlowPanel idPrefix="service-account-create" stepId="permissions">
					<div className="segmented-options token-access-picker">
						<button
							type="button"
							className={
								permissionMode === "read_only" ? "is-selected" : "ghost"
							}
							aria-pressed={permissionMode === "read_only"}
							onClick={() => setPermissionMode("read_only")}
						>
							<span>Read only</span>
							<small>Explicit read permissions only</small>
						</button>
						<button
							type="button"
							className={permissionMode === "custom" ? "is-selected" : "ghost"}
							aria-pressed={permissionMode === "custom"}
							onClick={() => setPermissionMode("custom")}
						>
							<span>Custom permissions</span>
							<small>Pick the operations this credential needs</small>
						</button>
						<button
							type="button"
							className={permissionMode === "all" ? "is-selected" : "ghost"}
							aria-pressed={permissionMode === "all"}
							onClick={() => setPermissionMode("all")}
						>
							<span>All permissions</span>
							<small>Leave the permission dimension unrestricted</small>
						</button>
					</div>
					{permissionMode === "custom" ? (
						<ScopePicker
							restrict
							selected={selectedPermissions}
							disabled={createMutation.isPending}
							showRestrictionToggle={false}
							onChange={(_, next) => {
								setSelectedPermissions(next);
								setFormError(null);
							}}
						/>
					) : permissionMode === "read_only" ? (
						<div className="info-banner">
							The preset includes {READ_ONLY_TOKEN_SCOPES.length} explicit read
							permissions and no write, delegation, execution, or
							subscription-management permissions.
						</div>
					) : (
						<div className="warning-banner">
							The resource scope can still narrow where the token acts, but its
							permission dimension will be unrestricted.
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
				<GuidedFlowPanel idPrefix="service-account-create" stepId="resources">
					<div className="segmented-options token-access-picker">
						<button
							type="button"
							className={resourceMode === "specific" ? "is-selected" : "ghost"}
							aria-pressed={resourceMode === "specific"}
							onClick={() => setResourceMode("specific")}
						>
							<span>Specific resources</span>
							<small>Search collections, classes, and objects by name</small>
						</button>
						<button
							type="button"
							className={resourceMode === "all" ? "is-selected" : "ghost"}
							aria-pressed={resourceMode === "all"}
							onClick={() => setResourceMode("all")}
						>
							<span>All resources</span>
							<small>Leave the resource dimension unrestricted</small>
						</button>
					</div>
					{resourceMode === "specific" ? (
						<TokenResourceScopePicker
							selected={selectedResources}
							disabled={createMutation.isPending}
							onChange={(next) => {
								setSelectedResources(next);
								setFormError(null);
							}}
						/>
					) : (
						<div className="warning-banner">
							The account&apos;s live group grants still apply, but this token
							will not add a resource boundary.
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
						summary={selectedResourceSummary}
						title={
							resourcesReady
								? "Resource scope ready"
								: "Choose at least one named resource"
						}
					/>
				</GuidedFlowPanel>
			) : null}

			{activeStep === "review" ? (
				<GuidedFlowPanel idPrefix="service-account-create" stepId="review">
					<div className="info-banner">
						Effective token authority = live principal/group grants ∩ permission
						scope ∩ resource scope.
					</div>
					<dl className="guided-flow-review-list">
						<div>
							<dt>Service account</dt>
							<dd>
								{name.trim()} · local identity scope
								{description.trim() ? ` · ${description.trim()}` : ""}
							</dd>
						</div>
						<div>
							<dt>Owner group</dt>
							<dd>
								{selectedOwner
									? `${formatScopedGroupName(selectedOwner)} (#${selectedOwner.id})`
									: `#${ownerGroupId}`}
							</dd>
						</div>
						<div>
							<dt>Initial token</dt>
							<dd>
								{tokenName.trim() || "initial"} ·{" "}
								{expiresAt
									? `expires ${new Date(expiresAt).toLocaleString()}`
									: "server default lifetime"}
							</dd>
						</div>
						<div>
							<dt>Permission scope</dt>
							<dd>{permissionSummary}</dd>
						</div>
						<div>
							<dt>Resource scope</dt>
							<dd>{selectedResourceSummary}</dd>
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
							Both token dimensions are unrestricted. The initial token will
							carry the principal&apos;s full current authority.
						</div>
					) : null}
					{createdAccount ? (
						<div className="warning-banner">
							Service account #{createdAccount.id} already exists. Retrying will
							create only its initial token.
						</div>
					) : null}
					<div className="form-actions">
						<button
							type="button"
							className="ghost"
							onClick={() => setActiveStep("resources")}
							disabled={createMutation.isPending}
						>
							Back
						</button>
						<button
							type="submit"
							disabled={
								createMutation.isPending ||
								!detailsReady ||
								!permissionsReady ||
								!resourcesReady
							}
						>
							{createMutation.isPending
								? createdAccount
									? "Creating token..."
									: "Creating account..."
								: createdAccount
									? "Retry initial token"
									: "Create account and token"}
						</button>
					</div>
					{createdAccount ? (
						<Link
							className="link-chip"
							href={`/admin/service-accounts/${createdAccount.id}`}
						>
							Open account without retrying
						</Link>
					) : null}
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
