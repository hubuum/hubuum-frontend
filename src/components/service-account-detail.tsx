"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { PrincipalPermissions } from "@/components/principal-permissions";
import { RawTokenReveal } from "@/components/raw-token-reveal";
import { TokenList } from "@/components/token-list";
import { TokenMintForm } from "@/components/token-mint-form";
import { useConfirm } from "@/lib/confirm-context";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1IamServiceAccountsByServiceAccountId,
	getApiV1IamGroups,
	getApiV1IamServiceAccountsByServiceAccountId,
	patchApiV1IamServiceAccountsByServiceAccountId,
	postApiV1IamServiceAccountsByServiceAccountIdDisable,
} from "@/lib/api/generated/client";
import type { UpdateServiceAccount } from "@/lib/api/generated/models";
import {
	type ConsoleGroup,
	type ConsoleServiceAccount,
	formatScopedGroupName,
	formatScopedServiceAccountName,
} from "@/lib/identity-scopes";
import { trackRecentItem } from "@/lib/recent-items";

type ServiceAccountDetailProps = {
	serviceAccountId: number;
};

async function fetchServiceAccount(id: number): Promise<ConsoleServiceAccount> {
	const response = await getApiV1IamServiceAccountsByServiceAccountId(id, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load service account."),
		);
	}

	return response.data;
}

async function fetchGroups(): Promise<ConsoleGroup[]> {
	const response = await getApiV1IamGroups(
		{ include_total: false },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load groups."),
		);
	}

	return response.data;
}

export function ServiceAccountDetail({
	serviceAccountId,
}: ServiceAccountDetailProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [description, setDescription] = useState("");
	const [ownerGroupId, setOwnerGroupId] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [rawToken, setRawToken] = useState<string | null>(null);

	const accountQuery = useQuery({
		queryKey: ["service-account", serviceAccountId],
		queryFn: async () => fetchServiceAccount(serviceAccountId),
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "service-account-owner"],
		queryFn: fetchGroups,
	});

	useEffect(() => {
		if (initialized || !accountQuery.data) {
			return;
		}
		setDescription(accountQuery.data.description ?? "");
		setOwnerGroupId(String(accountQuery.data.owner_group_id));
		setInitialized(true);
	}, [initialized, accountQuery.data]);

	useEffect(() => {
		const account = accountQuery.data;
		if (!account) {
			return;
		}

		trackRecentItem({
			type: "service-account",
			id: account.id,
			name: formatScopedServiceAccountName(account),
		});
	}, [accountQuery.data]);

	const updateMutation = useMutation({
		mutationFn: async (payload: UpdateServiceAccount) => {
			const response = await patchApiV1IamServiceAccountsByServiceAccountId(
				serviceAccountId,
				payload,
				{ credentials: "include" },
			);
			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to update service account.",
					),
				);
			}
			return response.data;
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["service-account", serviceAccountId],
			});
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			setFormError(null);
			setFormSuccess("Service account updated.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to update service account.",
			);
		},
	});

	const disableMutation = useMutation({
		mutationFn: async () => {
			const response =
				await postApiV1IamServiceAccountsByServiceAccountIdDisable(
					serviceAccountId,
					{ credentials: "include" },
				);
			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to disable service account.",
					),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["service-account", serviceAccountId],
			});
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", serviceAccountId],
			});
			setFormError(null);
			setFormSuccess(
				"Service account disabled. Its tokens no longer validate.",
			);
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to disable service account.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const response = await deleteApiV1IamServiceAccountsByServiceAccountId(
				serviceAccountId,
				{
					credentials: "include",
				},
			);
			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to delete service account.",
					),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			router.push("/admin/service-accounts");
			router.refresh();
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to delete service account.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const original = accountQuery.data;
		if (!original) {
			setFormError("Service account data is unavailable.");
			return;
		}

		const payload: UpdateServiceAccount = {};
		const trimmedDescription = description.trim();
		if (trimmedDescription !== (original.description ?? "")) {
			payload.description = trimmedDescription || null;
		}
		const parsedOwner = Number.parseInt(ownerGroupId, 10);
		if (
			Number.isFinite(parsedOwner) &&
			parsedOwner !== original.owner_group_id
		) {
			payload.owner_group_id = parsedOwner;
		}

		if (!Object.keys(payload).length) {
			setFormSuccess("No changes to save.");
			return;
		}

		updateMutation.mutate(payload);
	}

	async function onDisable() {
		const confirmed = await confirm({
			title: "Disable this service account?",
			description:
				"This is irreversible. All tokens stop validating and pending tasks are cancelled.",
			confirmLabel: "Disable",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}
		disableMutation.mutate();
	}

	async function onDelete() {
		const confirmed = await confirm({
			title: `Delete service account #${serviceAccountId}?`,
			description: "This removes the service account and cannot be undone.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate();
	}

	if (accountQuery.isLoading) {
		return <div className="card">Loading service account...</div>;
	}

	if (accountQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load service account.{" "}
				{accountQuery.error instanceof Error
					? accountQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const account = accountQuery.data;
	if (!account) {
		return (
			<div className="card error-banner">
				Service account data is unavailable.
			</div>
		);
	}

	const groups = groupsQuery.data ?? [];
	const disabled = Boolean(account.disabled_at);
	const busy =
		updateMutation.isPending ||
		disableMutation.isPending ||
		deleteMutation.isPending;

	return (
		<section className="stack">
			<header className="detail-identity">
				<div className="scope-heading">
					<h2>
						{formatScopedServiceAccountName(account)}{" "}
						<span className="muted">#{account.id}</span>
					</h2>
					<Link className="link-chip" href="/admin/service-accounts">
						Back to service accounts
					</Link>
				</div>
				<p className="detail-title-meta">Service account</p>
			</header>

			{disabled ? (
				<div className="warning-banner">
					This service account is disabled (since{" "}
					{new Date(account.disabled_at as string).toLocaleString()}). Its
					tokens no longer validate, and it cannot mint new tokens. Disabling is
					irreversible.
				</div>
			) : null}

			<form className="card stack" onSubmit={onSubmit}>
				<h3>Profile</h3>
				<div className="form-grid">
					<label className="control-field">
						<span>Name</span>
						<input value={account.name} readOnly disabled />
					</label>

					<label className="control-field">
						<span>Identity scope</span>
						<input
							value={account.identity_scope ?? "local"}
							readOnly
							disabled
						/>
					</label>

					<label className="control-field">
						<span>Owner group</span>
						<select
							value={ownerGroupId}
							onChange={(event) => setOwnerGroupId(event.target.value)}
							disabled={busy}
						>
							{groups.map((group) => (
								<option key={group.id} value={group.id}>
									{formatScopedGroupName(group)} (#{group.id})
								</option>
							))}
						</select>
					</label>

					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							disabled={busy}
						/>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions form-actions--spread">
					<button type="submit" disabled={busy}>
						{updateMutation.isPending ? "Saving..." : "Save changes"}
					</button>
					<div className="form-actions">
						<button
							type="button"
							className="ghost"
							onClick={onDisable}
							disabled={busy || disabled}
						>
							{disableMutation.isPending ? "Disabling..." : "Disable"}
						</button>
						<button
							type="button"
							className="danger"
							onClick={onDelete}
							disabled={busy}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete"}
						</button>
					</div>
				</div>
			</form>

			<div className="stack">
				<h3>Tokens</h3>
				{disabled ? (
					<div className="muted">
						Disabled service accounts cannot mint new tokens.
					</div>
				) : (
					<>
						{rawToken ? (
							<RawTokenReveal
								token={rawToken}
								onDismiss={() => setRawToken(null)}
							/>
						) : null}
						<TokenMintForm
							principalId={serviceAccountId}
							onMinted={(token) => setRawToken(token.token)}
						/>
					</>
				)}
				<TokenList principalId={serviceAccountId} />
			</div>

			<div className="stack">
				<h3>Effective permissions</h3>
				<PrincipalPermissions principalId={serviceAccountId} />
			</div>
		</section>
	);
}
