"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { CreateModal } from "@/components/create-modal";
import { EmptyState } from "@/components/empty-state";
import { TableExportMenu } from "@/components/table-export-menu";
import { TablePagination } from "@/components/table-pagination";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamGroups,
	getApiV1IamServiceAccounts,
	postApiV1IamServiceAccounts,
} from "@/lib/api/generated/client";
import type { NewServiceAccount } from "@/lib/api/generated/models";
import {
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
} from "@/lib/create-events";
import {
	type ConsoleGroup,
	type ConsoleServiceAccount,
	formatScopedGroupName,
	formatScopedServiceAccountName,
} from "@/lib/identity-scopes";
import {
	matchesFreeTextSearch,
	normalizeSearchTerm,
} from "@/lib/resource-search";
import { useCursorPagination } from "@/lib/use-cursor-pagination";
import type { TableExportView } from "@/lib/table-export";

function IconSearch() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.44 1.42-1.42-4.44-4.43A6.5 6.5 0 0 0 10.5 4m0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9"
				fill="currentColor"
			/>
		</svg>
	);
}

type ServiceAccountsPageData = {
	accounts: ConsoleServiceAccount[];
	nextCursor: string | null;
	prevCursor: string | null;
	totalCount: number | null;
};

async function fetchServiceAccounts(
	limit: number,
	cursor?: string,
): Promise<ServiceAccountsPageData> {
	const response = await getApiV1IamServiceAccounts(
		{ limit, cursor },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load service accounts."),
		);
	}

	const totalCountHeader = response.headers.get("X-Total-Count");
	const totalCount = totalCountHeader
		? Number.parseInt(totalCountHeader, 10)
		: null;

	return {
		accounts: response.data,
		nextCursor: response.headers.get("X-Next-Cursor"),
		prevCursor: response.headers.get("X-Prev-Cursor"),
		totalCount: Number.isFinite(totalCount) ? totalCount : null,
	};
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

export function ServiceAccountsTable() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const pagination = useCursorPagination({ defaultLimit: 100 });
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [ownerGroupId, setOwnerGroupId] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const [searchInput, setSearchInput] = useState(
		searchParams.get("search") ?? "",
	);

	const query = useQuery({
		queryKey: ["service-accounts", pagination.cursor, pagination.limit],
		queryFn: () => fetchServiceAccounts(pagination.limit, pagination.cursor),
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
			setCreateModalOpen(false);
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

	const accounts = query.data?.accounts ?? [];
	const groups = groupsQuery.data ?? [];
	const groupById = useMemo(() => {
		const map = new Map<number, ConsoleGroup>();
		for (const group of groups) {
			map.set(group.id, group);
		}
		return map;
	}, [groups]);
	const searchTerm = normalizeSearchTerm(searchParams.get("search"));
	const filteredAccounts = useMemo(
		() =>
			accounts.filter((account) =>
				matchesFreeTextSearch(
					searchTerm,
					account.name,
					formatScopedServiceAccountName(account),
					account.identity_scope,
					account.description,
					String(account.owner_group_id),
					groupById.get(account.owner_group_id)?.groupname,
					account.disabled_at ? "disabled" : "active",
				),
			),
		[accounts, groupById, searchTerm],
	);
	const exportView = useMemo<TableExportView<ConsoleServiceAccount>>(
		() => ({
			id: "service-accounts",
			fileName: "service-accounts-view",
			sheetName: "Service accounts",
			columns: [
				{ key: "id", label: "ID", getValue: (account) => account.id },
				{
					key: "name",
					label: "Name",
					getValue: (account) => formatScopedServiceAccountName(account),
				},
				{
					key: "identity_scope",
					label: "Scope",
					getValue: (account) => account.identity_scope ?? "local",
				},
				{
					key: "owner_group",
					label: "Owner group",
					getValue: (account) => {
						const ownerGroup = groupById.get(account.owner_group_id);
						return ownerGroup
							? `${formatScopedGroupName(ownerGroup)} (#${ownerGroup.id})`
							: `#${account.owner_group_id}`;
					},
				},
				{
					key: "status",
					label: "Status",
					getValue: (account) => (account.disabled_at ? "Disabled" : "Active"),
				},
				{
					key: "created_at",
					label: "Created",
					getValue: (account) => new Date(account.created_at),
				},
			],
			rows: filteredAccounts,
		}),
		[filteredAccounts, groupById],
	);

	useEffect(() => {
		if (searchParams.get("create") !== "1") {
			return;
		}

		const params = new URLSearchParams(searchParams.toString());
		params.delete("create");
		setCreateModalOpen(true);
		router.replace(
			params.toString() ? `${pathname}?${params.toString()}` : pathname,
		);
	}, [pathname, router, searchParams]);

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "admin-service-accounts") {
				return;
			}

			setFormError(null);
			setFormSuccess(null);
			setCreateModalOpen(true);
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	}, []);

	useEffect(() => {
		setSearchInput(searchParams.get("search") ?? "");
	}, [searchParams]);

	useEffect(() => {
		if (ownerGroupId || groups.length === 0) {
			return;
		}

		setOwnerGroupId(String(groups[0].id));
	}, [groups, ownerGroupId]);

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

	function onFilterSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		const trimmedSearchTerm = normalizeSearchTerm(searchInput);
		const params = new URLSearchParams(searchParams.toString());
		if (trimmedSearchTerm) {
			params.set("search", trimmedSearchTerm);
		} else {
			params.delete("search");
		}
		params.delete("cursor");

		const queryString = params.toString();
		router.push(queryString ? `${pathname}?${queryString}` : pathname);
	}

	function clearFilter() {
		setSearchInput("");
		const params = new URLSearchParams(searchParams.toString());
		params.delete("search");
		params.delete("cursor");

		const queryString = params.toString();
		router.push(queryString ? `${pathname}?${queryString}` : pathname);
	}

	function renderCreateForm() {
		return (
			<form className="stack" onSubmit={onSubmit}>
				<div className="form-grid">
					<div className="info-banner control-field--wide">
						New service accounts are created in the local identity scope.
					</div>
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
							required
							value={ownerGroupId}
							onChange={(event) => setOwnerGroupId(event.target.value)}
							disabled={groupsQuery.isLoading || groups.length === 0}
						>
							{groupsQuery.isLoading ? (
								<option value="">Loading groups...</option>
							) : null}
							{!groupsQuery.isLoading && groups.length === 0 ? (
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
						/>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{groupsQuery.isError ? (
					<div className="error-banner">
						Failed to load owner groups. Reload before creating a service
						account.
					</div>
				) : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions">
					<button
						type="submit"
						disabled={
							createMutation.isPending ||
							groupsQuery.isLoading ||
							groups.length === 0
						}
					>
						{createMutation.isPending
							? "Creating..."
							: "Create service account"}
					</button>
				</div>
			</form>
		);
	}

	if (query.isLoading) {
		return <div className="card">Loading service accounts...</div>;
	}

	if (query.isError) {
		return (
			<div className="card error-banner">
				Failed to load service accounts.{" "}
				{query.error instanceof Error ? query.error.message : "Unknown error"}
			</div>
		);
	}

	return (
		<div className="stack">
			<CreateModal
				open={isCreateModalOpen}
				title="Create service account"
				onClose={() => setCreateModalOpen(false)}
			>
				{renderCreateForm()}
			</CreateModal>

			<div className="card">
				<div className="table-header">
					<div className="table-title-row">
						<h3>Service accounts</h3>
						<span className="muted table-count">
							{searchTerm
								? `${filteredAccounts.length} shown of ${accounts.length}`
								: `${accounts.length} loaded`}
						</span>
					</div>
					<div className="table-tools">
						<TableExportMenu view={exportView} compact />
						<form className="table-filter-form" onSubmit={onFilterSubmit}>
							<div className="table-filter-field">
								<input
									aria-label="Filter loaded service accounts"
									className="table-filter-input"
									value={searchInput}
									onChange={(event) => setSearchInput(event.target.value)}
									placeholder="Filter loaded items"
								/>
								{normalizeSearchTerm(searchInput) ? (
									<button
										type="button"
										className="ghost table-filter-clear"
										onClick={clearFilter}
										aria-label="Clear service account filter"
									>
										Clear
									</button>
								) : null}
							</div>
							<button
								type="submit"
								className="ghost icon-button"
								aria-label="Filter service accounts"
							>
								<IconSearch />
							</button>
						</form>
					</div>
				</div>
				{filteredAccounts.length === 0 ? (
					<EmptyState
						title={
							searchTerm
								? `No service accounts match "${searchTerm}".`
								: "No service accounts available."
						}
						description={
							searchTerm
								? "Clear the filter to return to the full service account list."
								: "Create a service account for non-human automation, then mint scoped tokens for it."
						}
						action={
							searchTerm ? null : (
								<button type="button" onClick={() => setCreateModalOpen(true)}>
									New service account
								</button>
							)
						}
					/>
				) : (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>ID</th>
									<th>Name</th>
									<th>Scope</th>
									<th>Owner group</th>
									<th>Status</th>
									<th>Created</th>
								</tr>
							</thead>
							<tbody>
								{filteredAccounts.map((account) => {
									const ownerGroup = groupById.get(account.owner_group_id);
									return (
										<tr key={account.id}>
											<td>{account.id}</td>
											<td>
												<Link
													className="row-link"
													href={`/admin/service-accounts/${account.id}`}
												>
													{formatScopedServiceAccountName(account)}
												</Link>
											</td>
											<td>{account.identity_scope ?? "local"}</td>
											<td>
												{ownerGroup
													? `${formatScopedGroupName(ownerGroup)} (#${ownerGroup.id})`
													: `#${account.owner_group_id}`}
											</td>
											<td>{account.disabled_at ? "Disabled" : "Active"}</td>
											<td>{new Date(account.created_at).toLocaleString()}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
				{query.data &&
				(query.data.nextCursor ||
					query.data.prevCursor ||
					pagination.hasPrevPage) ? (
					<TablePagination
						hasNextPage={!!query.data.nextCursor}
						hasPrevPage={pagination.hasPrevPage || !!query.data.prevCursor}
						onNextPage={() =>
							query.data?.nextCursor &&
							pagination.goToNextPage(query.data.nextCursor)
						}
						onPrevPage={() =>
							pagination.goToPrevPage(query.data?.prevCursor ?? undefined)
						}
						onFirstPage={pagination.goToFirstPage}
						currentCount={accounts.length}
						totalCount={query.data.totalCount}
					/>
				) : null}
			</div>
		</div>
	);
}
