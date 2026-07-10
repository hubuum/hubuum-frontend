"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { TableExportMenu } from "@/components/table-export-menu";
import { useConfirm } from "@/lib/confirm-context";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1IamUsersByUserId,
	getApiV1IamUsers,
	postApiV1IamUsers,
} from "@/lib/api/generated/client";
import {
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
} from "@/lib/create-events";
import {
	type ConsoleUser,
	isProviderManagedUser,
	normalizeIdentityScope,
	type ScopedNewUser,
} from "@/lib/identity-scopes";
import type { TableExportView } from "@/lib/table-export";

async function fetchUsers(): Promise<ConsoleUser[]> {
	const response = await getApiV1IamUsers(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load users."));
	}

	return response.data;
}

export function AdminUsersTable() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [username, setUsername] = useState("");
	const [properName, setProperName] = useState("");
	const [password, setPassword] = useState("");
	const [email, setEmail] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
	const [tableError, setTableError] = useState<string | null>(null);
	const [tableSuccess, setTableSuccess] = useState<string | null>(null);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const query = useQuery({
		queryKey: ["admin-users"],
		queryFn: fetchUsers,
	});
	const createMutation = useMutation({
		mutationFn: async (payload: ScopedNewUser) => {
			const response = await postApiV1IamUsers(payload, {
				credentials: "include",
			});

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to create user."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
			setUsername("");
			setProperName("");
			setPassword("");
			setEmail("");
			setFormError(null);
			setTableError(null);
			setFormSuccess("User created.");
			setTableSuccess("User created.");
			setCreateModalOpen(false);
		},
		onError: (error) => {
			setFormSuccess(null);
			setTableSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to create user.",
			);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async (userIds: number[]) => {
			const results = await Promise.all(
				userIds.map(async (userId) => {
					const response = await deleteApiV1IamUsersByUserId(userId, {
						credentials: "include",
					});

					if (response.status !== 204) {
						throw new Error(
							`#${userId}: ${getApiErrorMessage(response.data, "Failed to delete user.")}`,
						);
					}
				}),
			);
			return results.length;
		},
		onSuccess: async (count) => {
			await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
			setSelectedUserIds([]);
			setTableError(null);
			setTableSuccess(`${count} user${count === 1 ? "" : "s"} deleted.`);
		},
		onError: (error) => {
			setTableSuccess(null);
			setTableError(
				error instanceof Error
					? error.message
					: "Failed to delete selected users.",
			);
		},
	});

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "admin-users") {
				return;
			}

			setFormError(null);
			setFormSuccess(null);
			setCreateModalOpen(true);
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	}, []);

	const users = query.data ?? [];
	const selectableUsers = useMemo(
		() => users.filter((user) => !isProviderManagedUser(user)),
		[users],
	);
	const allSelected =
		selectableUsers.length > 0 &&
		selectedUserIds.length === selectableUsers.length;

	useEffect(() => {
		if (!selectedUserIds.length) return;
		const selectableIds = new Set(selectableUsers.map((user) => user.id));
		setSelectedUserIds((current) =>
			current.filter((userId) => selectableIds.has(userId)),
		);
	}, [selectableUsers, selectedUserIds.length]);
	const exportView = useMemo<TableExportView<ConsoleUser>>(
		() => ({
			id: "admin-users",
			fileName: "user-directory-view",
			sheetName: "Users",
			columns: [
				{ key: "id", label: "ID", getValue: (user) => user.id },
				{
					key: "username",
					label: "Username",
					getValue: (user) => user.name,
				},
				{
					key: "identity_scope",
					label: "Identity scope",
					getValue: (user) => normalizeIdentityScope(user.identity_scope),
				},
				{
					key: "provider",
					label: "Provider",
					getValue: (user) => user.provider_kind ?? "local",
				},
				{ key: "email", label: "Email", getValue: (user) => user.email },
				{
					key: "created_at",
					label: "Created",
					getValue: (user) => new Date(user.created_at),
				},
				{
					key: "updated_at",
					label: "Updated",
					getValue: (user) => new Date(user.updated_at),
				},
			],
			rows: users,
		}),
		[users],
	);

	useEffect(() => {
		if (!selectedUserIds.length) {
			return;
		}

		const existingIds = new Set(selectableUsers.map((user) => user.id));
		setSelectedUserIds((current) =>
			current.filter((userId) => existingIds.has(userId)),
		);
	}, [selectableUsers, selectedUserIds.length]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);
		setTableError(null);
		setTableSuccess(null);

		const trimmedUsername = username.trim();
		if (!trimmedUsername) {
			setFormError("Username is required.");
			return;
		}

		if (!password) {
			setFormError("Password is required.");
			return;
		}

		const trimmedEmail = email.trim();
		const trimmedProperName = properName.trim();
		const payload: ScopedNewUser = {
			name: trimmedUsername,
			password,
		};

		if (trimmedEmail) {
			payload.email = trimmedEmail;
		}

		if (trimmedProperName) {
			payload.proper_name = trimmedProperName;
		}

		createMutation.mutate(payload);
	}

	function toggleAllUsers(checked: boolean) {
		if (checked) {
			setSelectedUserIds(selectableUsers.map((user) => user.id));
			return;
		}

		setSelectedUserIds([]);
	}

	function toggleUser(userId: number, checked: boolean) {
		setSelectedUserIds((current) => {
			if (checked) {
				return current.includes(userId) ? current : [...current, userId];
			}
			return current.filter((id) => id !== userId);
		});
	}

	async function deleteSelectedUsers() {
		const selectableIds = new Set(selectableUsers.map((user) => user.id));
		const deletableUserIds = selectedUserIds.filter((userId) =>
			selectableIds.has(userId),
		);
		if (!deletableUserIds.length) {
			return;
		}

		setTableError(null);
		setTableSuccess(null);

		const confirmed = await confirm({
			title: `Delete ${deletableUserIds.length} selected user${
				deletableUserIds.length === 1 ? "" : "s"
			}?`,
			description: "This removes the selected users and cannot be undone.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate(deletableUserIds);
	}

	function renderCreateUserForm() {
		return (
			<form className="stack" onSubmit={onSubmit}>
				<div className="form-grid">
					<div className="info-banner control-field--wide">
						New users are created in the local identity scope. Provider-managed
						users are materialized by their authentication provider.
					</div>
					<label className="control-field">
						<span>Username</span>
						<input
							required
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							placeholder="e.g. alice"
						/>
					</label>

					<label className="control-field">
						<span>Display name (optional)</span>
						<input
							value={properName}
							onChange={(event) => setProperName(event.target.value)}
							placeholder="e.g. Alice Doe"
						/>
					</label>

					<label className="control-field">
						<span>Password</span>
						<input
							required
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							placeholder="Temporary password"
							autoComplete="new-password"
						/>
					</label>

					<label className="control-field control-field--wide">
						<span>Email (optional)</span>
						<input
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="name@example.com"
						/>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions">
					<button type="submit" disabled={createMutation.isPending}>
						{createMutation.isPending ? "Creating..." : "Create user"}
					</button>
				</div>
			</form>
		);
	}

	if (query.isLoading) {
		return <div className="card">Loading users...</div>;
	}

	if (query.isError) {
		return (
			<div className="card error-banner">
				Failed to load users.{" "}
				{query.error instanceof Error ? query.error.message : "Unknown error"}
			</div>
		);
	}

	return (
		<div className="stack">
			<CreateModal
				open={isCreateModalOpen}
				title="Create user"
				onClose={() => setCreateModalOpen(false)}
			>
				{renderCreateUserForm()}
			</CreateModal>

			<div className="card">
				<div className="table-header">
					<h3>User directory</h3>
					<div className="table-tools">
						<span className="muted">
							{users.length} loaded
							{selectedUserIds.length
								? ` • ${selectedUserIds.length} selected`
								: ""}
						</span>
						<TableExportMenu view={exportView} compact />
						<button
							type="button"
							className="danger"
							onClick={deleteSelectedUsers}
							disabled={
								deleteMutation.isPending || selectedUserIds.length === 0
							}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete selected"}
						</button>
					</div>
				</div>
				{tableError ? <div className="error-banner">{tableError}</div> : null}
				{tableSuccess ? <div className="muted">{tableSuccess}</div> : null}

				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th className="check-col">
									<input
										type="checkbox"
										aria-label="Select all users"
										checked={allSelected}
										onChange={(event) => toggleAllUsers(event.target.checked)}
									/>
								</th>
								<th>ID</th>
								<th>Scope</th>
								<th>Username</th>
								<th>Provider</th>
								<th>Email</th>
								<th>Created</th>
								<th>Updated</th>
							</tr>
						</thead>
						<tbody>
							{users.map((user) => (
								<tr key={user.id}>
									<td className="check-col">
										<input
											type="checkbox"
											aria-label={`Select user ${user.name}`}
											checked={selectedUserIds.includes(user.id)}
											disabled={isProviderManagedUser(user)}
											onChange={(event) =>
												toggleUser(user.id, event.target.checked)
											}
										/>
									</td>
									<td>{user.id}</td>
									<td>{normalizeIdentityScope(user.identity_scope)}</td>
									<td>
										<Link className="row-link" href={`/admin/users/${user.id}`}>
											{user.name}
										</Link>
									</td>
									<td>
										{user.provider_kind ?? "local"}
										{isProviderManagedUser(user) ? " · managed" : ""}
									</td>
									<td>{user.email ?? "-"}</td>
									<td>{new Date(user.created_at).toLocaleString()}</td>
									<td>{new Date(user.updated_at).toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
