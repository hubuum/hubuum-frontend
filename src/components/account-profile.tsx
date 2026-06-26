"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamUsers,
	patchApiV1IamUsersByUserId,
} from "@/lib/api/generated/client";
import type { UpdateUser, UserResponse } from "@/lib/api/generated/models";

type AccountProfileProps = {
	currentUsername: string | null;
};

async function fetchCurrentUser(
	currentUsername: string | null,
): Promise<UserResponse> {
	const response = await getApiV1IamUsers(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load user."));
	}

	const users = response.data;
	const matchedUser = currentUsername
		? users.find((user) => user.username === currentUsername)
		: null;
	const currentUser = matchedUser ?? (users.length === 1 ? users[0] : null);

	if (!currentUser) {
		throw new Error("Current user was not returned by the user endpoint.");
	}

	return currentUser;
}

export function AccountProfile({ currentUsername }: AccountProfileProps) {
	const queryClient = useQueryClient();
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [initializedUserId, setInitializedUserId] = useState<number | null>(
		null,
	);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const userQuery = useQuery({
		queryKey: ["account-user", currentUsername],
		queryFn: async () => fetchCurrentUser(currentUsername),
	});

	useEffect(() => {
		if (!userQuery.data || initializedUserId === userQuery.data.id) {
			return;
		}

		setUsername(userQuery.data.username);
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
			setUsername(updatedUser.username);
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

		const trimmedUsername = username.trim();
		if (!trimmedUsername) {
			setFormError("Username is required.");
			return;
		}

		const trimmedEmail = email.trim();
		const payload: UpdateUser = {};

		if (trimmedUsername !== originalUser.username) {
			payload.username = trimmedUsername;
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

	return (
		<form className="card stack" onSubmit={onSubmit}>
			<h3>Profile</h3>

			<div className="form-grid">
				<label className="control-field">
					<span>Username</span>
					<input
						required
						value={username}
						onChange={(event) => setUsername(event.target.value)}
					/>
				</label>

				<label className="control-field">
					<span>Email</span>
					<input
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="name@example.com"
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
					/>
				</label>
			</div>

			<div className="muted">
				Created {new Date(user.created_at).toLocaleString()} &middot; Last updated{" "}
				{new Date(user.updated_at).toLocaleString()}
			</div>

			{formError ? <div className="error-banner">{formError}</div> : null}
			{formSuccess ? <div className="muted">{formSuccess}</div> : null}

			<div className="form-actions">
				<button type="submit" disabled={updateMutation.isPending}>
					{updateMutation.isPending ? "Saving..." : "Save changes"}
				</button>
			</div>
		</form>
	);
}
