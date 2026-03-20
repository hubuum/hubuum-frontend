"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { TablePagination } from "@/components/table-pagination";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1NamespacesByNamespaceId,
	getApiV1IamGroups,
	getApiV1Namespaces,
	postApiV1Namespaces,
} from "@/lib/api/generated/client";
import type {
	Group,
	Namespace,
	NewNamespaceWithAssignee,
} from "@/lib/api/generated/models";
import {
	DESELECT_ALL_EVENT,
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
	SELECT_ALL_EVENT,
	SELECTION_STATE_EVENT,
} from "@/lib/create-events";
import {
	matchesFreeTextSearch,
	normalizeSearchTerm,
} from "@/lib/resource-search";
import { useCursorPagination } from "@/lib/use-cursor-pagination";
import { useResizableTable } from "@/lib/use-resizable-table";
import { useShiftSelect } from "@/lib/use-shift-select";
import { useTableKeyboardNav } from "@/lib/use-table-keyboard-nav";
import { useTableSort } from "@/lib/use-table-sort";

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

type NamespacesPageData = {
	namespaces: Namespace[];
	nextCursor: string | null;
	prevCursor: string | null;
};

async function fetchNamespaces(
	limit: number,
	cursor?: string,
	sort?: string,
): Promise<NamespacesPageData> {
	const response = await getApiV1Namespaces(
		{ limit, cursor, sort },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load namespaces."),
		);
	}

	const nextCursor = response.headers.get("X-Next-Cursor");
	const prevCursor = response.headers.get("X-Prev-Cursor");

	return {
		namespaces: response.data,
		nextCursor,
		prevCursor,
	};
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

export function NamespacesTable() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [groupId, setGroupId] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [selectedNamespaceIds, setSelectedNamespaceIds] = useState<number[]>(
		[],
	);
	const [tableError, setTableError] = useState<string | null>(null);
	const [tableSuccess, setTableSuccess] = useState<string | null>(null);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const [searchInput, setSearchInput] = useState(
		searchParams.get("search") ?? "",
	);

	useResizableTable({ tableId: "namespaces-table", storageKey: "namespaces" });

	const pagination = useCursorPagination({ defaultLimit: 100 });
	const { sortState, setSort, getSortParam } = useTableSort();

	const query = useQuery({
		queryKey: [
			"namespaces",
			pagination.cursor,
			pagination.limit,
			getSortParam(),
		],
		queryFn: () =>
			fetchNamespaces(pagination.limit, pagination.cursor, getSortParam()),
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "namespace-form"],
		queryFn: fetchGroups,
	});
	const createMutation = useMutation({
		mutationFn: async (payload: NewNamespaceWithAssignee) => {
			const response = await postApiV1Namespaces(payload, {
				credentials: "include",
			});

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to create namespace."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
			setName("");
			setDescription("");
			if (groupsQuery.data?.length) {
				setGroupId(String(groupsQuery.data[0].id));
			}
			setFormError(null);
			setFormSuccess("Namespace created.");
			setCreateModalOpen(false);
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to create namespace.",
			);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async (namespaceIds: number[]) => {
			const results = await Promise.all(
				namespaceIds.map(async (namespaceId) => {
					const response = await deleteApiV1NamespacesByNamespaceId(
						namespaceId,
						{
							credentials: "include",
						},
					);

					if (response.status !== 204) {
						throw new Error(
							`#${namespaceId}: ${getApiErrorMessage(response.data, "Failed to delete namespace.")}`,
						);
					}
				}),
			);
			return results.length;
		},
		onSuccess: async (count) => {
			await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
			await queryClient.invalidateQueries({
				queryKey: ["namespaces", "class-form"],
			});
			setSelectedNamespaceIds([]);
			setTableError(null);
			setTableSuccess(`${count} namespace${count === 1 ? "" : "s"} deleted.`);
		},
		onError: (error) => {
			setTableSuccess(null);
			setTableError(
				error instanceof Error
					? error.message
					: "Failed to delete selected namespaces.",
			);
		},
	});

	const deleteSelectedNamespaces = useCallback(() => {
		if (!selectedNamespaceIds.length) {
			return;
		}

		setTableError(null);
		setTableSuccess(null);

		const confirmed = window.confirm(
			`Delete ${selectedNamespaceIds.length} selected namespace(s)?`,
		);
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate([...selectedNamespaceIds]);
	}, [selectedNamespaceIds, deleteMutation]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const parsedGroupId = Number.parseInt(groupId, 10);
		if (!Number.isFinite(parsedGroupId) || parsedGroupId < 1) {
			setFormError("Group ID must be a positive integer.");
			return;
		}

		createMutation.mutate({
			name: name.trim(),
			description: description.trim(),
			group_id: parsedGroupId,
		});
	}

	const groups = groupsQuery.data ?? [];
	const pageData = query.data;
	const namespaces = pageData?.namespaces ?? [];
	const searchTerm = normalizeSearchTerm(searchParams.get("search"));
	const filteredNamespaces = useMemo(
		() =>
			namespaces.filter((namespace) =>
				matchesFreeTextSearch(
					searchTerm,
					namespace.name,
					namespace.description,
				),
			),
		[namespaces, searchTerm],
	);
	const allSelected =
		filteredNamespaces.length > 0 &&
		selectedNamespaceIds.length === filteredNamespaces.length;

	const shiftSelect = useShiftSelect({
		items: filteredNamespaces,
		selectedIds: selectedNamespaceIds,
		setSelectedIds: setSelectedNamespaceIds,
		getId: (namespace) => namespace.id,
	});

	const keyboardNav = useTableKeyboardNav({
		items: filteredNamespaces,
		getId: (namespace) => namespace.id,
		onOpen: (namespace) => router.push(`/namespaces/${namespace.id}`),
	});

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
		setSearchInput(searchParams.get("search") ?? "");
	}, [searchParams]);

	useEffect(() => {
		if (groupId || groups.length === 0) {
			return;
		}

		setGroupId(String(groups[0].id));
	}, [groupId, groups]);

	useEffect(() => {
		if (!selectedNamespaceIds.length) {
			return;
		}

		const existingIds = new Set(
			filteredNamespaces.map((namespace) => namespace.id),
		);
		setSelectedNamespaceIds((current) => {
			const next = current.filter((namespaceId) =>
				existingIds.has(namespaceId),
			);
			return next.length === current.length ? current : next;
		});
	}, [filteredNamespaces, selectedNamespaceIds]);

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "namespaces") {
				return;
			}

			setCreateModalOpen(true);
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	}, []);

	useEffect(() => {
		const onDeselectAll = () => {
			setSelectedNamespaceIds([]);
		};

		const onSelectAll = () => {
			setSelectedNamespaceIds(
				filteredNamespaces.map((namespace) => namespace.id),
			);
		};

		window.addEventListener(DESELECT_ALL_EVENT, onDeselectAll);
		window.addEventListener(SELECT_ALL_EVENT, onSelectAll);
		return () => {
			window.removeEventListener(DESELECT_ALL_EVENT, onDeselectAll);
			window.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
		};
	}, [filteredNamespaces]);

	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent(SELECTION_STATE_EVENT, {
				detail: {
					count: selectedNamespaceIds.length,
					deleteHandler:
						selectedNamespaceIds.length > 0 ? deleteSelectedNamespaces : null,
				},
			}),
		);
	}, [selectedNamespaceIds.length, deleteSelectedNamespaces]);

	if (query.isLoading) {
		return <div className="card">Loading namespaces...</div>;
	}

	if (query.isError) {
		return (
			<div className="card error-banner">
				Failed to load namespaces.{" "}
				{query.error instanceof Error ? query.error.message : "Unknown error"}
			</div>
		);
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

		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	function clearFilter() {
		setSearchInput("");
		const params = new URLSearchParams(searchParams.toString());
		params.delete("search");

		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	function renderSortIndicator(column: string) {
		if (sortState.column !== column) {
			return <span className="sort-indicator">⇅</span>;
		}

		return (
			<span className="sort-indicator sort-indicator--active">
				{sortState.direction === "asc" ? "↑" : "↓"}
			</span>
		);
	}

	function renderCreateNamespaceForm() {
		return (
			<form className="stack" onSubmit={onSubmit}>
				<div className="form-grid">
					<label className="control-field">
						<span>Name</span>
						<input
							required
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="e.g. infra"
						/>
					</label>

					<div className="control-field">
						<span>Assignee group</span>
						{groups.length > 0 ? (
							<select
								required
								value={groupId}
								onChange={(event) => setGroupId(event.target.value)}
							>
								{groups.map((group) => (
									<option key={group.id} value={group.id}>
										{group.groupname} (#{group.id})
									</option>
								))}
							</select>
						) : (
							<input
								required
								type="number"
								min={1}
								value={groupId}
								onChange={(event) => setGroupId(event.target.value)}
								placeholder={
									groupsQuery.isLoading ? "Loading groups..." : "Enter group id"
								}
								disabled={groupsQuery.isLoading}
							/>
						)}
					</div>

					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							required
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Namespace purpose"
						/>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{groupsQuery.isError ? (
					<div className="muted">
						Could not load groups automatically. Falling back to manual group ID
						entry.
					</div>
				) : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions">
					<button type="submit" disabled={createMutation.isPending}>
						{createMutation.isPending ? "Creating..." : "Create namespace"}
					</button>
				</div>
			</form>
		);
	}

	return (
		<div className="stack">
			<CreateModal
				open={isCreateModalOpen}
				title="Create namespace"
				onClose={() => setCreateModalOpen(false)}
			>
				{renderCreateNamespaceForm()}
			</CreateModal>

			<div className="card table-wrap">
				<div className="table-header">
					<div className="table-title-row">
						<h3>Namespace catalog</h3>
						<span className="muted table-count">
							{searchTerm
								? `${filteredNamespaces.length} shown of ${namespaces.length}`
								: `${namespaces.length} loaded`}
							{selectedNamespaceIds.length
								? ` · ${selectedNamespaceIds.length} selected`
								: ""}
						</span>
					</div>
					<div className="table-tools">
						<form className="table-filter-form" onSubmit={onFilterSubmit}>
							<div className="table-filter-field">
								<input
									aria-label="Filter loaded namespaces"
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
										aria-label="Clear namespace filter"
									>
										Clear
									</button>
								) : null}
							</div>
							<button
								type="submit"
								className="ghost icon-button"
								aria-label="Filter namespaces"
							>
								<IconSearch />
							</button>
						</form>
					</div>
				</div>
				{tableError ? <div className="error-banner">{tableError}</div> : null}
				{tableSuccess ? <div className="muted">{tableSuccess}</div> : null}
				{filteredNamespaces.length === 0 ? (
					<div className="empty-state">
						{searchTerm
							? `No namespaces match "${searchTerm}".`
							: "No namespaces available."}
					</div>
				) : (
					<table id="namespaces-table">
						<thead>
							<tr>
								<th className="check-col">
									<input
										type="checkbox"
										aria-label="Select all namespaces"
										checked={allSelected}
										onChange={(event) =>
											shiftSelect.handleSelectAll(event.target.checked)
										}
									/>
								</th>
								<th className="sortable" onClick={() => setSort("id")}>
									ID{renderSortIndicator("id")}
								</th>
								<th className="sortable" onClick={() => setSort("name")}>
									Name{renderSortIndicator("name")}
								</th>
								<th className="sortable" onClick={() => setSort("description")}>
									Description{renderSortIndicator("description")}
								</th>
							</tr>
						</thead>
						<tbody>
							{filteredNamespaces.map((namespace, index) => {
								const isSelected = selectedNamespaceIds.includes(namespace.id);
								const isFocused = keyboardNav.focusedId === namespace.id;
								const rowClassName = [
									isSelected ? "table-row-selected" : "",
									isFocused ? "table-row-focused" : "",
								]
									.filter(Boolean)
									.join(" ");

								return (
									<tr
										key={namespace.id}
										className={rowClassName}
										data-table-row-index={index}
									>
										<td className="check-col">
											<input
												type="checkbox"
												aria-label={`Select namespace ${namespace.name}`}
												checked={isSelected}
												onChange={(event) =>
													shiftSelect.handleClick(
														namespace.id,
														event.target.checked,
														(event.nativeEvent as MouseEvent).shiftKey,
													)
												}
											/>
										</td>
										<td>{namespace.id}</td>
										<td>
											<Link
												href={`/namespaces/${namespace.id}`}
												className="row-link"
											>
												{namespace.name}
											</Link>
										</td>
										<td>{namespace.description || "-"}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
				{pageData && (pageData.nextCursor || pageData.prevCursor) ? (
					<TablePagination
						hasNextPage={!!pageData.nextCursor}
						hasPrevPage={!!pageData.prevCursor}
						onNextPage={() =>
							pageData.nextCursor &&
							pagination.goToNextPage(pageData.nextCursor)
						}
						onPrevPage={() =>
							pageData.prevCursor &&
							pagination.goToPrevPage(pageData.prevCursor)
						}
						onFirstPage={pagination.goToFirstPage}
						currentCount={namespaces.length}
					/>
				) : null}
			</div>
		</div>
	);
}
