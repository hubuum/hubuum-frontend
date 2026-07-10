"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMe,
	getApiV1IamUsersByUserId,
	patchApiV1IamUsersByUserId,
} from "@/lib/api/generated/client";
import type { UpdateUser } from "@/lib/api/generated/models";
import {
	type ConsoleUser,
	isProviderManagedUser,
	normalizeIdentityScope,
} from "@/lib/identity-scopes";

type AccountProfileProps = {
	currentUsername: string | null;
};

async function fetchCurrentUser(): Promise<ConsoleUser> {
	const meResponse = await getApiV1IamMe({ credentials: "include" });
	if (meResponse.status !== 200) {
		throw new Error(
			getApiErrorMessage(meResponse.data, "Failed to load account."),
		);
	}

	const userId = meResponse.data.principal.principal_id;
	const userResponse = await getApiV1IamUsersByUserId(userId, {
		credentials: "include",
	});
	if (userResponse.status !== 200) {
		throw new Error(
			getApiErrorMessage(userResponse.data, "Failed to load user."),
		);
	}

	return userResponse.data;
}

export function AccountProfile({ currentUsername }: AccountProfileProps) {
	const queryClient = useQueryClient();
	const [properName, setProperName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [initializedUserId, setInitializedUserId] = useState<number | null>(
		null,
	);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const userQuery = useQuery({
		queryKey: ["account-user", currentUsername],
		queryFn: async () => fetchCurrentUser(),
	});

	useEffect(() => {
		if (!userQuery.data || initializedUserId === userQuery.data.id) {
			return;
		}

		setProperName(userQuery.data.proper_name ?? "");
		setEmail(userQuery.data.email ?? "");
		setInitializedUserId(userQuery.data.id);
	}, [initializedUserId, userQuery.data]);

	const updateMutation = useMutation({
		mutationFn: async ({
			userId,
			payload,
		}: {
			userId: number;
			payload: UpdateUser;
		}) => {
			const response = await patchApiV1IamUsersByUserId(userId, payload, {
				credentials: "include",
			});

			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to update account."),
				);
			}

			return response.data;
		},
		onSuccess: async (updatedUser) => {
			await queryClient.invalidateQueries({
				queryKey: ["account-user", currentUsername],
			});
			await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
			setProperName(updatedUser.proper_name ?? "");
			setEmail(updatedUser.email ?? "");
			setPassword("");
			setFormError(null);
			setFormSuccess("Account updated.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to update account.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const originalUser = userQuery.data;
		if (!originalUser) {
			setFormError("User data is unavailable.");
			return;
		}
		if (isProviderManagedUser(originalUser)) {
			setFormError("Provider-managed profiles are read-only in Hubuum.");
			return;
		}

		const trimmedProperName = properName.trim();
		const trimmedEmail = email.trim();
		const payload: UpdateUser = {};

		const originalProperName = originalUser.proper_name ?? "";
		if (trimmedProperName !== originalProperName) {
			payload.proper_name = trimmedProperName || null;
		}

		const originalEmail = originalUser.email ?? "";
		if (trimmedEmail !== originalEmail) {
			payload.email = trimmedEmail || null;
		}

		if (password) {
			payload.password = password;
		}

		if (!Object.keys(payload).length) {
			setFormSuccess("No changes to save.");
			return;
		}

		updateMutation.mutate({ userId: originalUser.id, payload });
	}

	if (userQuery.isLoading) {
		return <div className="card">Loading account...</div>;
	}

	if (userQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load account.{" "}
				{userQuery.error instanceof Error
					? userQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const user = userQuery.data;
	if (!user) {
		return <div className="card error-banner">User data is unavailable.</div>;
	}
	const providerManaged = isProviderManagedUser(user);

	return (
		<form className="card stack" onSubmit={onSubmit}>
			<h3>Profile</h3>
			{providerManaged ? (
				<div className="info-banner">
					Your profile is managed by the {user.provider_kind ?? "external"}
					provider. Update it in the source directory.
				</div>
			) : null}

			<div className="form-grid">
				<label className="control-field">
					<span>Username</span>
					<input value={user.name} readOnly disabled />
				</label>

				<label className="control-field">
					<span>Identity scope</span>
					<input
						value={normalizeIdentityScope(user.identity_scope)}
						readOnly
						disabled
					/>
				</label>

				<label className="control-field">
					<span>Display name</span>
					<input
						value={properName}
						onChange={(event) => setProperName(event.target.value)}
						placeholder="e.g. Alice Doe"
						disabled={providerManaged}
					/>
				</label>

				<label className="control-field">
					<span>Email</span>
					<input
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="name@example.com"
						disabled={providerManaged}
					/>
				</label>

				<label className="control-field control-field--wide">
					<span>Password</span>
					<input
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="Leave blank to keep the current password"
						autoComplete="new-password"
						disabled={providerManaged}
					/>
				</label>
			</div>

			<div className="muted">
				Created {new Date(user.created_at).toLocaleString()} &middot; Last
				updated {new Date(user.updated_at).toLocaleString()}
			</div>

			{formError ? <div className="error-banner">{formError}</div> : null}
			{formSuccess ? <div className="muted">{formSuccess}</div> : null}

			<div className="form-actions">
				<button
					type="submit"
					disabled={providerManaged || updateMutation.isPending}
				>
					{updateMutation.isPending ? "Saving..." : "Save changes"}
				</button>
			</div>
		</form>
	);
}
