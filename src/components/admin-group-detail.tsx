"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { TableExportMenu } from "@/components/table-export-menu";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1IamGroupsByGroupIdMembersByPrincipalId,
	getApiV1IamGroupsByGroupId,
	getApiV1IamGroupsByGroupIdMembers,
	getApiV1IamServiceAccounts,
	getApiV1IamUsers,
	postApiV1IamGroupsByGroupIdMembersByPrincipalId,
} from "@/lib/api/generated/client";
import { useConfirm } from "@/lib/confirm-context";
import {
	formatGroupMembershipCandidateOption,
	type GroupMembershipCandidate,
	groupMembershipCandidateKindLabel,
	groupMembershipCandidateMatches,
	humanMembershipCandidate,
	resolveGroupMembershipCandidate,
	serviceAccountMembershipCandidate,
} from "@/lib/group-membership-candidates";
import {
	type ConsoleGroup,
	type ConsolePrincipalMember,
	type ConsoleServiceAccount,
	type ConsoleUser,
	formatScopedIdentityName,
	isProviderManagedGroup,
	normalizeIdentityScope,
} from "@/lib/identity-scopes";
import { trackRecentItem } from "@/lib/recent-items";
import type { TableExportColumn, TableExportView } from "@/lib/table-export";

type AdminGroupDetailProps = {
	groupId: number;
};

type UpdateGroupPayload = {
	groupname: string;
	description?: string;
};

type UpdateGroupResult = {
	descriptionRequested: boolean;
	descriptionUpdated: boolean;
	group: ConsoleGroup;
};

async function fetchGroup(groupId: number): Promise<ConsoleGroup> {
	const response = await getApiV1IamGroupsByGroupId(groupId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load group."));
	}

	return response.data;
}

async function fetchUsers(): Promise<ConsoleUser[]> {
	const response = await getApiV1IamUsers(
		{ include_total: false, limit: 250 },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load users."));
	}

	return response.data;
}

async function fetchServiceAccounts(): Promise<ConsoleServiceAccount[]> {
	const response = await getApiV1IamServiceAccounts(
		{ include_total: false, limit: 250 },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load service accounts."),
		);
	}

	return response.data;
}

async function fetchGroupMembers(
	groupId: number,
): Promise<ConsolePrincipalMember[]> {
	const response = await getApiV1IamGroupsByGroupIdMembers(
		groupId,
		{ include_total: false, limit: 250 },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load group members."),
		);
	}

	return response.data.flatMap((membership) =>
		membership.principal ? [membership.principal] : [],
	);
}

async function readResponsePayload(response: Response): Promise<unknown> {
	const raw = await response.text();
	if (!raw) {
		return {};
	}

	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return { message: raw };
	}
}

async function updateGroup(
	groupId: number,
	payload: UpdateGroupPayload,
): Promise<UpdateGroupResult> {
	const response = await fetch(
		`/_hubuum-bff/hubuum/api/v1/iam/groups/${groupId}`,
		{
			method: "PATCH",
			credentials: "include",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		},
	);
	const responsePayload = await readResponsePayload(response);

	if (response.status === 200) {
		return {
			descriptionRequested: payload.description !== undefined,
			descriptionUpdated: payload.description !== undefined,
			group: responsePayload as ConsoleGroup,
		};
	}

	if (payload.description !== undefined) {
		const fallbackResponse = await fetch(
			`/_hubuum-bff/hubuum/api/v1/iam/groups/${groupId}`,
			{
				method: "PATCH",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ groupname: payload.groupname }),
			},
		);
		const fallbackPayload = await readResponsePayload(fallbackResponse);

		if (fallbackResponse.status === 200) {
			return {
				descriptionRequested: true,
				descriptionUpdated: false,
				group: fallbackPayload as ConsoleGroup,
			};
		}

		throw new Error(
			getApiErrorMessage(fallbackPayload, "Failed to update group."),
		);
	}

	throw new Error(
		getApiErrorMessage(responsePayload, "Failed to update group."),
	);
}

const memberExportColumns: TableExportColumn<ConsolePrincipalMember>[] = [
	{
		key: "id",
		label: "ID",
		getValue: (member) => member.principal_id,
	},
	{ key: "name", label: "Name", getValue: (member) => member.name },
	{
		key: "identity_scope",
		label: "Identity scope",
		getValue: (member) => normalizeIdentityScope(member.identity_scope),
	},
	{
		key: "kind",
		label: "Kind",
		getValue: (member) =>
			member.kind === "service_account" ? "Service account" : "Human",
	},
];

export function AdminGroupDetail({ groupId }: AdminGroupDetailProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [groupname, setGroupname] = useState("");
	const [description, setDescription] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [memberInput, setMemberInput] = useState("");
	const [membershipError, setMembershipError] = useState<string | null>(null);
	const [membershipSuccess, setMembershipSuccess] = useState<string | null>(
		null,
	);
	const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
	const datalistId = `admin-group-member-options-${groupId}`;

	const groupQuery = useQuery({
		queryKey: ["admin-group", groupId],
		queryFn: async () => fetchGroup(groupId),
	});
	const usersQuery = useQuery({
		queryKey: ["admin-users", "group-detail"],
		queryFn: fetchUsers,
	});
	const serviceAccountsQuery = useQuery({
		queryKey: ["service-accounts", "group-detail"],
		queryFn: fetchServiceAccounts,
	});
	const membersQuery = useQuery({
		queryKey: ["admin-group-members", groupId],
		queryFn: async () => fetchGroupMembers(groupId),
	});

	useEffect(() => {
		if (initialized || !groupQuery.data) {
			return;
		}

		setGroupname(groupQuery.data.groupname);
		setDescription(groupQuery.data.description ?? "");
		setInitialized(true);
	}, [groupQuery.data, initialized]);

	useEffect(() => {
		const group = groupQuery.data;
		if (!group) {
			return;
		}

		trackRecentItem({
			type: "admin-group",
			id: group.id,
			name: formatScopedIdentityName(group.identity_scope, group.groupname),
		});
	}, [groupQuery.data]);

	const members = membersQuery.data ?? [];
	const users = usersQuery.data ?? [];
	const serviceAccounts = serviceAccountsQuery.data ?? [];
	const memberIdSet = useMemo(
		() => new Set(members.map((member) => member.principal_id)),
		[members],
	);
	const allMembersSelected =
		members.length > 0 && selectedMemberIds.length === members.length;
	const membershipCandidates = useMemo(
		() =>
			[
				...users.map(humanMembershipCandidate),
				...serviceAccounts.map(serviceAccountMembershipCandidate),
			].sort((left, right) =>
				formatGroupMembershipCandidateOption(left).localeCompare(
					formatGroupMembershipCandidateOption(right),
				),
			),
		[serviceAccounts, users],
	);
	const candidatesNotInGroup = useMemo(
		() =>
			membershipCandidates.filter(
				(candidate) => !memberIdSet.has(candidate.id),
			),
		[memberIdSet, membershipCandidates],
	);
	const memberInputTerm = memberInput.trim().toLowerCase();
	const memberSuggestions = useMemo(() => {
		const filteredCandidates = memberInputTerm
			? candidatesNotInGroup.filter((candidate) =>
					groupMembershipCandidateMatches(candidate, memberInputTerm),
				)
			: candidatesNotInGroup;

		return filteredCandidates.slice(0, 50);
	}, [candidatesNotInGroup, memberInputTerm]);

	const updateMutation = useMutation({
		mutationFn: async (payload: UpdateGroupPayload) =>
			updateGroup(groupId, payload),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: ["admin-group", groupId],
			});
			await queryClient.invalidateQueries({ queryKey: ["admin-groups"] });
			await queryClient.invalidateQueries({ queryKey: ["groups"] });
			setGroupname(result.group.groupname);
			setDescription(result.group.description ?? "");
			setFormError(null);
			setFormSuccess(
				result.descriptionRequested && !result.descriptionUpdated
					? "Group name updated. This API currently does not accept description updates."
					: "Group updated.",
			);
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to update group.",
			);
		},
	});

	const addMemberMutation = useMutation({
		mutationFn: async (candidate: GroupMembershipCandidate) => {
			const response = await postApiV1IamGroupsByGroupIdMembersByPrincipalId(
				groupId,
				candidate.id,
				{
					credentials: "include",
				},
			);

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to add member to group."),
				);
			}

			return candidate;
		},
		onSuccess: async (candidate) => {
			await queryClient.invalidateQueries({
				queryKey: ["admin-group-members", groupId],
			});
			await queryClient.invalidateQueries({
				queryKey: ["admin-group-member-counts"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["principal-groups", candidate.id],
			});
			setMembershipError(null);
			setMembershipSuccess(
				`${groupMembershipCandidateKindLabel(candidate)} ${candidate.name} added to group.`,
			);
			setMemberInput("");
		},
		onError: (error) => {
			setMembershipSuccess(null);
			setMembershipError(
				error instanceof Error
					? error.message
					: "Failed to add member to group.",
			);
		},
	});

	const removeMemberMutation = useMutation({
		mutationFn: async (principalIds: number[]) => {
			await Promise.all(
				principalIds.map(async (principalId) => {
					const response =
						await deleteApiV1IamGroupsByGroupIdMembersByPrincipalId(
							groupId,
							principalId,
							{
								credentials: "include",
							},
						);

					if (response.status !== 204) {
						throw new Error(
							getApiErrorMessage(
								response.data,
								`Failed to remove principal #${principalId} from group.`,
							),
						);
					}
				}),
			);

			return principalIds.length;
		},
		onSuccess: async (count) => {
			await queryClient.invalidateQueries({
				queryKey: ["admin-group-members", groupId],
			});
			await queryClient.invalidateQueries({
				queryKey: ["admin-group-member-counts"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["principal-groups"],
			});
			setSelectedMemberIds([]);
			setMembershipError(null);
			setMembershipSuccess(
				`${count} member${count === 1 ? "" : "s"} removed from group.`,
			);
		},
		onError: (error) => {
			setMembershipSuccess(null);
			setMembershipError(
				error instanceof Error
					? error.message
					: "Failed to remove member from group.",
			);
		},
	});

	useEffect(() => {
		if (!selectedMemberIds.length) {
			return;
		}

		const existingIds = new Set(members.map((member) => member.principal_id));
		setSelectedMemberIds((current) =>
			current.filter((memberId) => existingIds.has(memberId)),
		);
	}, [members, selectedMemberIds.length]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);
		if (groupQuery.data && isProviderManagedGroup(groupQuery.data)) {
			setFormError("Provider-managed groups are read-only in Hubuum.");
			return;
		}

		const trimmedGroupname = groupname.trim();
		if (!trimmedGroupname) {
			setFormError("Group name is required.");
			return;
		}

		const trimmedDescription = description.trim();
		const originalDescription = (groupQuery.data?.description ?? "").trim();
		const payload: UpdateGroupPayload = {
			groupname: trimmedGroupname,
		};

		if (trimmedDescription !== originalDescription) {
			payload.description = trimmedDescription;
		}

		updateMutation.mutate(payload);
	}

	function addMember() {
		if (groupQuery.data && isProviderManagedGroup(groupQuery.data)) {
			setMembershipError(
				"Provider-managed group memberships are read-only in Hubuum.",
			);
			return;
		}
		if (addMemberMutation.isPending || removeMemberMutation.isPending) {
			return;
		}

		const targetCandidate = resolveGroupMembershipCandidate(
			memberInput,
			candidatesNotInGroup,
		);
		if (!targetCandidate) {
			setMembershipSuccess(null);
			setMembershipError(
				"Select a human or service account from the suggestions, or enter an exact scoped name, email, or principal ID.",
			);
			return;
		}

		setMembershipError(null);
		setMembershipSuccess(null);
		addMemberMutation.mutate(targetCandidate);
	}

	function toggleAllMembers(checked: boolean) {
		if (groupQuery.data && isProviderManagedGroup(groupQuery.data)) return;
		if (checked) {
			setSelectedMemberIds(members.map((member) => member.principal_id));
			return;
		}

		setSelectedMemberIds([]);
	}

	function toggleMember(principalId: number, checked: boolean) {
		if (groupQuery.data && isProviderManagedGroup(groupQuery.data)) return;
		setSelectedMemberIds((current) => {
			if (checked) {
				return current.includes(principalId)
					? current
					: [...current, principalId];
			}

			return current.filter((id) => id !== principalId);
		});
	}

	async function removeSelectedMembers() {
		if (groupQuery.data && isProviderManagedGroup(groupQuery.data)) {
			setMembershipError(
				"Provider-managed group memberships are read-only in Hubuum.",
			);
			return;
		}
		if (addMemberMutation.isPending || removeMemberMutation.isPending) {
			return;
		}

		if (!selectedMemberIds.length) {
			return;
		}

		const confirmed = await confirm({
			title: `Remove ${selectedMemberIds.length} selected member${
				selectedMemberIds.length === 1 ? "" : "s"
			}?`,
			description: "This removes the selected principals from this group.",
			confirmLabel: "Remove",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		setMembershipError(null);
		setMembershipSuccess(null);
		removeMemberMutation.mutate([...selectedMemberIds]);
	}

	if (groupQuery.isLoading) {
		return <div className="card">Loading group...</div>;
	}

	if (groupQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load group.{" "}
				{groupQuery.error instanceof Error
					? groupQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const group = groupQuery.data;
	if (!group) {
		return <div className="card error-banner">Group data is unavailable.</div>;
	}
	const providerManaged = isProviderManagedGroup(group);

	const isMembershipUpdating =
		addMemberMutation.isPending || removeMemberMutation.isPending;
	const candidateSourcesLoading =
		usersQuery.isLoading || serviceAccountsQuery.isLoading;
	const candidateSourcesUnavailable =
		usersQuery.isError && serviceAccountsQuery.isError;
	const memberExportView: TableExportView<ConsolePrincipalMember> = {
		id: `admin.group.${group.id}.members`,
		fileName: `${group.groupname}-members-view`,
		sheetName: "Group members",
		columns: memberExportColumns,
		rows: members,
	};

	return (
		<section className="stack">
			<header className="detail-identity">
				<div className="scope-heading">
					<h2>
						{formatScopedIdentityName(group.identity_scope, group.groupname)}{" "}
						<span className="muted">#{group.id}</span>
					</h2>
					<Link className="link-chip" href="/admin/groups">
						Back to groups
					</Link>
				</div>
				<p className="detail-title-meta">Admin group</p>
			</header>

			{providerManaged ? (
				<div className="info-banner">
					This group and its memberships are managed by {group.managed_by}. Make
					changes in the source directory.
				</div>
			) : null}

			<form className="card stack" onSubmit={onSubmit}>
				<h3>Group profile</h3>

				<div className="form-grid">
					<label className="control-field">
						<span>Group name</span>
						<input
							required
							value={groupname}
							onChange={(event) => setGroupname(event.target.value)}
							disabled={providerManaged}
						/>
					</label>

					<label className="control-field">
						<span>Identity scope</span>
						<input
							value={normalizeIdentityScope(group.identity_scope)}
							readOnly
							disabled
						/>
					</label>

					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							disabled={providerManaged}
						/>
					</label>
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

			<section className="card stack">
				<h3>Members ({members.length})</h3>

				<div className="form-grid">
					<label className="control-field control-field--wide">
						<span>Add member</span>
						<input
							list={datalistId}
							value={memberInput}
							onChange={(event) => setMemberInput(event.target.value)}
							placeholder="Type a human or service account name, email, or principal ID"
							disabled={
								providerManaged ||
								candidateSourcesLoading ||
								candidateSourcesUnavailable ||
								isMembershipUpdating ||
								candidatesNotInGroup.length === 0
							}
						/>
						<datalist id={datalistId}>
							{memberSuggestions.map((candidate) => (
								<option
									key={candidate.id}
									value={formatGroupMembershipCandidateOption(candidate)}
								/>
							))}
						</datalist>
					</label>
				</div>

				<div className="form-actions">
					<button
						type="button"
						onClick={addMember}
						disabled={
							providerManaged ||
							candidateSourcesLoading ||
							candidateSourcesUnavailable ||
							isMembershipUpdating ||
							candidatesNotInGroup.length === 0
						}
					>
						{addMemberMutation.isPending ? "Adding..." : "Add member"}
					</button>
					<span className="muted">
						{providerManaged
							? "Membership is synchronized from the identity provider."
							: candidateSourcesLoading
								? "Loading member candidates..."
								: candidateSourcesUnavailable
									? "Member candidates are unavailable."
									: candidatesNotInGroup.length === 0
										? "No additional principals are available."
										: `${candidatesNotInGroup.length} principal${candidatesNotInGroup.length === 1 ? "" : "s"} available to add.`}
					</span>
				</div>

				{usersQuery.isError ? (
					<div className="error-banner">
						Failed to load users.{" "}
						{usersQuery.error instanceof Error
							? usersQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{serviceAccountsQuery.isError ? (
					<div className="error-banner">
						Failed to load service accounts.{" "}
						{serviceAccountsQuery.error instanceof Error
							? serviceAccountsQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{membersQuery.isError ? (
					<div className="error-banner">
						Failed to load group members.{" "}
						{membersQuery.error instanceof Error
							? membersQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{membershipError ? (
					<div className="error-banner">{membershipError}</div>
				) : null}
				{membershipSuccess ? (
					<div className="muted">{membershipSuccess}</div>
				) : null}

				{membersQuery.isLoading ? (
					<div className="muted">Loading members...</div>
				) : null}
				{!membersQuery.isLoading && members.length === 0 ? (
					<div className="muted">No members in this group.</div>
				) : null}

				{!membersQuery.isLoading && members.length > 0 ? (
					<>
						<div className="table-header">
							<h4>Current members</h4>
							<div className="table-tools">
								<TableExportMenu
									view={memberExportView}
									disabled={membersQuery.isFetching}
									compact
								/>
								<span className="muted">
									{selectedMemberIds.length
										? `${selectedMemberIds.length} selected`
										: ""}
								</span>
								<button
									type="button"
									className="danger"
									onClick={removeSelectedMembers}
									disabled={
										providerManaged ||
										isMembershipUpdating ||
										selectedMemberIds.length === 0
									}
								>
									{removeMemberMutation.isPending
										? "Removing..."
										: "Remove selected"}
								</button>
							</div>
						</div>
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th className="check-col">
											<input
												type="checkbox"
												aria-label="Select all members"
												checked={allMembersSelected}
												onChange={(event) =>
													toggleAllMembers(event.target.checked)
												}
												disabled={providerManaged}
											/>
										</th>
										<th>ID</th>
										<th>Scope</th>
										<th>Name</th>
										<th>Kind</th>
									</tr>
								</thead>
								<tbody>
									{members.map((member) => (
										<tr key={member.principal_id}>
											<td className="check-col">
												<input
													type="checkbox"
													aria-label={`Select member ${member.name}`}
													checked={selectedMemberIds.includes(
														member.principal_id,
													)}
													onChange={(event) =>
														toggleMember(
															member.principal_id,
															event.target.checked,
														)
													}
													disabled={providerManaged || isMembershipUpdating}
												/>
											</td>
											<td>{member.principal_id}</td>
											<td>{normalizeIdentityScope(member.identity_scope)}</td>
											<td>{member.name}</td>
											<td>
												<span className="badge">
													{member.kind === "service_account"
														? "Service account"
														: "Human"}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				) : null}
			</section>
		</section>
	);
}
