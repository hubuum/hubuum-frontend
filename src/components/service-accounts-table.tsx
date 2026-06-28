"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamGroups,
	getApiV1IamServiceAccounts,
	postApiV1IamServiceAccounts,
} from "@/lib/api/generated/client";
import type {
	Group,
	NewServiceAccount,
	ServiceAccountResponse,
} from "@/lib/api/generated/models";

async function fetchServiceAccounts(): Promise<ServiceAccountResponse[]> {
	const response = await getApiV1IamServiceAccounts(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load service accounts."),
		);
	}

	return response.data;
}

async function fetchGroups(): Promise<Group[]> {
	const response = await getApiV1IamGroups(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load groups."),
		);
	}

	return response.data;
}

export function ServiceAccountsTable() {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [ownerGroupId, setOwnerGroupId] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const query = useQuery({
		queryKey: ["service-accounts"],
		queryFn: fetchServiceAccounts,
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "service-account-owner"],
		queryFn: fetchGroups,
	});

	const createMutation = useMutation({
		mutationFn: async (payload: NewServiceAccount) => {
			const response = await postApiV1IamServiceAccounts(payload, {
				credentials: "include",
			});

			// Create returns 201 only (per OpenAPI + generated types).
			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to create service account.",
					),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			setName("");
			setDescription("");
			setOwnerGroupId("");
			setFormError(null);
			setFormSuccess("Service account created.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to create service account.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const trimmedName = name.trim();
		if (!trimmedName) {
			setFormError("Name is required.");
			return;
		}

		const parsedOwner = Number.parseInt(ownerGroupId, 10);
		if (!Number.isFinite(parsedOwner)) {
			setFormError("Select an owner group.");
			return;
		}

		const payload: NewServiceAccount = {
			name: trimmedName,
			owner_group_id: parsedOwner,
		};
		const trimmedDescription = description.trim();
		if (trimmedDescription) {
			payload.description = trimmedDescription;
		}

		createMutation.mutate(payload);
	}

	const accounts = query.data ?? [];
	const groups = groupsQuery.data ?? [];

	return (
		<div className="stack">
			<form className="card stack" onSubmit={onSubmit}>
				<h3>Create service account</h3>
				<div className="form-grid">
					<label className="control-field">
						<span>Name</span>
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
							value={ownerGroupId}
							onChange={(event) => setOwnerGroupId(event.target.value)}
						>
							<option value="">Select a group…</option>
							{groups.map((group) => (
								<option key={group.id} value={group.id}>
									{group.groupname} (#{group.id})
								</option>
							))}
						</select>
					</label>

					<label className="control-field control-field--wide">
						<span>Description (optional)</span>
						<input
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions">
					<button type="submit" disabled={createMutation.isPending}>
						{createMutation.isPending
							? "Creating..."
							: "Create service account"}
					</button>
				</div>
			</form>

			<div className="card table-wrap">
				<div className="table-header">
					<h3>Service accounts</h3>
					<span className="muted">{accounts.length} loaded</span>
				</div>
				{query.isError ? (
					<div className="error-banner">
						Failed to load service accounts.{" "}
						{query.error instanceof Error
							? query.error.message
							: "Unknown error"}
					</div>
				) : null}
				<table>
					<thead>
						<tr>
							<th>ID</th>
							<th>Name</th>
							<th>Owner group</th>
							<th>Status</th>
							<th>Created</th>
						</tr>
					</thead>
					<tbody>
						{accounts.map((account) => (
							<tr key={account.id}>
								<td>{account.id}</td>
								<td>
									<Link
										className="row-link"
										href={`/admin/service-accounts/${account.id}`}
									>
										{account.name}
									</Link>
								</td>
								<td>#{account.owner_group_id}</td>
								<td>{account.disabled_at ? "Disabled" : "Active"}</td>
								<td>{new Date(account.created_at).toLocaleString()}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
