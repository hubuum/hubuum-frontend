"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { EmptyState } from "@/components/empty-state";
import { TableExportMenu } from "@/components/table-export-menu";
import { TablePagination } from "@/components/table-pagination";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1CollectionsByCollectionId,
	getApiV1Collections,
	getApiV1IamGroups,
	postApiV1Collections,
} from "@/lib/api/generated/client";
import type {
	Collection,
	NewCollectionWithAssignee,
} from "@/lib/api/generated/models";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
	formatCollectionPath,
	getCollectionPath,
	isRootCollection,
} from "@/lib/collection-hierarchy";
import { useConfirm } from "@/lib/confirm-context";
import {
	DESELECT_ALL_EVENT,
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
	SELECT_ALL_EVENT,
	SELECTION_STATE_EVENT,
} from "@/lib/create-events";
import {
	type ConsoleGroup,
	formatScopedGroupName,
} from "@/lib/identity-scopes";
import {
	matchesFreeTextSearch,
	normalizeSearchTerm,
} from "@/lib/resource-search";
import type { TableExportView } from "@/lib/table-export";
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

type CollectionsPageData = {
	collections: Collection[];
	nextCursor: string | null;
	prevCursor: string | null;
	totalCount: number | null;
};

async function fetchCollections(
	limit: number,
	cursor?: string,
	sort?: string,
): Promise<CollectionsPageData> {
	const response = await getApiV1Collections(
		{ limit, cursor, sort },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}

	const nextCursor = response.headers.get("X-Next-Cursor");
	const prevCursor = response.headers.get("X-Prev-Cursor");
	const totalCountHeader = response.headers.get("X-Total-Count");
	const totalCount = totalCountHeader
		? Number.parseInt(totalCountHeader, 10)
		: null;

	return {
		collections: response.data,
		nextCursor,
		prevCursor,
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

export function CollectionsTable() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [groupId, setGroupId] = useState("");
	const [parentCollectionId, setParentCollectionId] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [selectedCollectionIds, setSelectedCollectionIds] = useState<number[]>(
		[],
	);
	const [tableError, setTableError] = useState<string | null>(null);
	const [tableSuccess, setTableSuccess] = useState<string | null>(null);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const [searchInput, setSearchInput] = useState(
		searchParams.get("search") ?? "",
	);

	useResizableTable({
		tableId: "collections-table",
		storageKey: "collections",
	});

	const pagination = useCursorPagination({ defaultLimit: 100 });
	const { sortState, setSort, getSortParam } = useTableSort();

	const query = useQuery({
		queryKey: [
			"collections",
			pagination.cursor,
			pagination.limit,
			getSortParam(),
		],
		queryFn: () =>
			fetchCollections(pagination.limit, pagination.cursor, getSortParam()),
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "collection-form"],
		queryFn: fetchGroups,
	});
	const createMutation = useMutation({
		mutationFn: async (payload: NewCollectionWithAssignee) => {
			const response = await postApiV1Collections(payload, {
				credentials: "include",
			});

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to create collection."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			setName("");
			setDescription("");
			const rootCollection = (query.data?.collections ?? []).find(
				isRootCollection,
			);
			setParentCollectionId(rootCollection ? String(rootCollection.id) : "");
			if (groupsQuery.data?.length) {
				setGroupId(String(groupsQuery.data[0].id));
			}
			setFormError(null);
			setFormSuccess("Collection created.");
			setCreateModalOpen(false);
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to create collection.",
			);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async (collectionIds: number[]) => {
			const results = await Promise.all(
				collectionIds.map(async (collectionId) => {
					const response = await deleteApiV1CollectionsByCollectionId(
						collectionId,
						{
							credentials: "include",
						},
					);

					if (response.status !== 204) {
						throw new Error(
							`#${collectionId}: ${getApiErrorMessage(response.data, "Failed to delete collection.")}`,
						);
					}
				}),
			);
			return results.length;
		},
		onSuccess: async (count) => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			await queryClient.invalidateQueries({
				queryKey: ["collections", "class-form"],
			});
			setSelectedCollectionIds([]);
			setTableError(null);
			setTableSuccess(`${count} collection${count === 1 ? "" : "s"} deleted.`);
		},
		onError: (error) => {
			setTableSuccess(null);
			setTableError(
				error instanceof Error
					? error.message
					: "Failed to delete selected collections.",
			);
		},
	});

	const groups = groupsQuery.data ?? [];
	const pageData = query.data;
	const collections = pageData?.collections ?? [];
	const hierarchy = useMemo(
		() => buildCollectionHierarchy(collections),
		[collections],
	);
	const rootCollection = collections.find(isRootCollection);
	const treeRows = useMemo(
		() => hierarchy.flatNodes.map((node) => node.collection),
		[hierarchy.flatNodes],
	);
	const depthByCollectionId = useMemo(
		() =>
			new Map(
				hierarchy.flatNodes.map((node) => [node.collection.id, node.depth]),
			),
		[hierarchy.flatNodes],
	);

	const deleteSelectedCollections = useCallback(async () => {
		if (!selectedCollectionIds.length) {
			return;
		}

		setTableError(null);
		setTableSuccess(null);

		const selectedCollections = selectedCollectionIds
			.map((collectionId) => hierarchy.byId.get(collectionId))
			.filter((collection): collection is Collection => Boolean(collection));
		const blockedCollections = selectedCollections.filter(
			(collection) =>
				isRootCollection(collection) ||
				(hierarchy.childrenByParentId.get(collection.id)?.length ?? 0) > 0,
		);
		if (blockedCollections.length > 0) {
			setTableError(
				`Cannot delete ${blockedCollections
					.map((collection) => `${collection.name} (#${collection.id})`)
					.join(
						", ",
					)}. Root collections and collections with child collections must be kept or emptied first.`,
			);
			return;
		}

		const confirmed = await confirm({
			title: `Delete ${selectedCollectionIds.length} selected collection${
				selectedCollectionIds.length === 1 ? "" : "s"
			}?`,
			description:
				"This removes the selected collections and cannot be undone.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate([...selectedCollectionIds]);
	}, [
		confirm,
		hierarchy.byId,
		hierarchy.childrenByParentId,
		selectedCollectionIds,
		deleteMutation,
	]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const parsedGroupId = Number.parseInt(groupId, 10);
		if (!Number.isFinite(parsedGroupId) || parsedGroupId < 1) {
			setFormError("Group ID must be a positive integer.");
			return;
		}

		const trimmedParentCollectionId = parentCollectionId.trim();
		let parentCollectionPayload: number | null = null;
		if (trimmedParentCollectionId) {
			const parsedParentCollectionId = Number.parseInt(
				trimmedParentCollectionId,
				10,
			);
			if (
				!Number.isFinite(parsedParentCollectionId) ||
				parsedParentCollectionId < 1
			) {
				setFormError("Parent collection must be a positive integer.");
				return;
			}
			parentCollectionPayload = parsedParentCollectionId;
		}

		createMutation.mutate({
			name: name.trim(),
			description: description.trim(),
			group_id: parsedGroupId,
			parent_collection_id: parentCollectionPayload,
		});
	}

	const searchTerm = normalizeSearchTerm(searchParams.get("search"));
	const filteredCollections = useMemo(
		() =>
			treeRows.filter((collection) => {
				const parent =
					collection.parent_collection_id === null ||
					collection.parent_collection_id === undefined
						? null
						: hierarchy.byId.get(collection.parent_collection_id);
				const pathLabel = formatCollectionPath(
					getCollectionPath(collection, hierarchy.byId),
				);
				return matchesFreeTextSearch(
					searchTerm,
					String(collection.id),
					collection.name,
					collection.description,
					parent?.name,
					pathLabel,
				);
			}),
		[hierarchy.byId, searchTerm, treeRows],
	);
	const exportView = useMemo<TableExportView<Collection>>(
		() => ({
			id: "collections",
			fileName: "collections-view",
			sheetName: "Collections",
			columns: [
				{ key: "id", label: "ID", getValue: (collection) => collection.id },
				{
					key: "name",
					label: "Name",
					getValue: (collection) => collection.name,
				},
				{
					key: "parent",
					label: "Parent",
					getValue: (collection) => {
						const parentId = collection.parent_collection_id;
						const parent =
							parentId === null || parentId === undefined
								? null
								: hierarchy.byId.get(parentId);
						return parent ? `${parent.name} (#${parent.id})` : "Root";
					},
				},
				{
					key: "children",
					label: "Children",
					getValue: (collection) =>
						hierarchy.childrenByParentId.get(collection.id)?.length ?? 0,
				},
				{
					key: "description",
					label: "Description",
					getValue: (collection) => collection.description,
				},
			],
			rows: filteredCollections,
		}),
		[filteredCollections, hierarchy.byId, hierarchy.childrenByParentId],
	);
	const allSelected =
		filteredCollections.length > 0 &&
		selectedCollectionIds.length === filteredCollections.length;

	const shiftSelect = useShiftSelect({
		items: filteredCollections,
		selectedIds: selectedCollectionIds,
		setSelectedIds: setSelectedCollectionIds,
		getId: (collection) => collection.id,
	});

	const keyboardNav = useTableKeyboardNav({
		items: filteredCollections,
		getId: (collection) => collection.id,
		onOpen: (collection) => router.push(`/collections/${collection.id}`),
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
		if (parentCollectionId || !rootCollection) {
			return;
		}

		setParentCollectionId(String(rootCollection.id));
	}, [parentCollectionId, rootCollection]);

	useEffect(() => {
		if (!selectedCollectionIds.length) {
			return;
		}

		const existingIds = new Set(
			filteredCollections.map((collection) => collection.id),
		);
		setSelectedCollectionIds((current) => {
			const next = current.filter((collectionId) =>
				existingIds.has(collectionId),
			);
			return next.length === current.length ? current : next;
		});
	}, [filteredCollections, selectedCollectionIds]);

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "collections") {
				return;
			}

			setCreateModalOpen(true);
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	}, []);

	useEffect(() => {
		const onDeselectAll = () => {
			setSelectedCollectionIds([]);
		};

		const onSelectAll = () => {
			setSelectedCollectionIds(
				filteredCollections.map((collection) => collection.id),
			);
		};

		window.addEventListener(DESELECT_ALL_EVENT, onDeselectAll);
		window.addEventListener(SELECT_ALL_EVENT, onSelectAll);
		return () => {
			window.removeEventListener(DESELECT_ALL_EVENT, onDeselectAll);
			window.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
		};
	}, [filteredCollections]);

	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent(SELECTION_STATE_EVENT, {
				detail: {
					count: selectedCollectionIds.length,
					deleteHandler:
						selectedCollectionIds.length > 0 ? deleteSelectedCollections : null,
				},
			}),
		);
	}, [selectedCollectionIds.length, deleteSelectedCollections]);

	if (query.isLoading) {
		return <div className="card">Loading collections...</div>;
	}

	if (query.isError) {
		return (
			<div className="card error-banner">
				Failed to load collections.{" "}
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
		params.delete("cursor");

		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	function clearFilter() {
		setSearchInput("");
		const params = new URLSearchParams(searchParams.toString());
		params.delete("search");
		params.delete("cursor");

		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	function renderSortIndicator(column: string) {
		if (sortState.column !== column) {
			return (
				<span className="sort-indicator" aria-hidden="true">
					⇅
				</span>
			);
		}

		return (
			<span
				className="sort-indicator sort-indicator--active"
				aria-hidden="true"
			>
				{sortState.direction === "asc" ? "↑" : "↓"}
			</span>
		);
	}

	function getSortAria(column: string): "ascending" | "descending" | "none" {
		if (sortState.column !== column) return "none";
		return sortState.direction === "asc" ? "ascending" : "descending";
	}

	function renderCreateCollectionForm() {
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
										{formatScopedGroupName(group)} (#{group.id})
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

					<label
						className="control-field control-field--wide"
						htmlFor="collection-parent"
					>
						<span>Parent collection</span>
						{collections.length > 0 ? (
							<select
								id="collection-parent"
								value={parentCollectionId}
								onChange={(event) => setParentCollectionId(event.target.value)}
							>
								<option value="">Root collection</option>
								{treeRows.map((collection) => (
									<option key={collection.id} value={collection.id}>
										{formatCollectionOption(collection, hierarchy.byId)}
									</option>
								))}
							</select>
						) : (
							<input
								id="collection-parent"
								type="number"
								min={1}
								value={parentCollectionId}
								onChange={(event) => setParentCollectionId(event.target.value)}
								placeholder={
									query.isLoading
										? "Loading collections..."
										: "Optional parent collection ID"
								}
								disabled={query.isLoading}
							/>
						)}
					</label>

					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							required
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Collection purpose"
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
						{createMutation.isPending ? "Creating..." : "Create collection"}
					</button>
				</div>
			</form>
		);
	}

	return (
		<div className="stack">
			<CreateModal
				open={isCreateModalOpen}
				title="Create collection"
				onClose={() => setCreateModalOpen(false)}
			>
				{renderCreateCollectionForm()}
			</CreateModal>

			<div className="card resource-index">
				<div className="table-header">
					<div className="resource-index-title">
						<p className="eyebrow">Data model</p>
						<div className="table-title-row">
							<h2>Collections</h2>
							<span className="muted table-count">
								{searchTerm
									? `${filteredCollections.length} shown of ${collections.length}`
									: `${collections.length} loaded`}
								{selectedCollectionIds.length
									? ` · ${selectedCollectionIds.length} selected`
									: ""}
							</span>
						</div>
					</div>
					<div className="table-tools">
						<TableExportMenu view={exportView} compact />
						<form className="table-filter-form" onSubmit={onFilterSubmit}>
							<div className="table-filter-field">
								<input
									aria-label="Filter loaded collections"
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
										aria-label="Clear collection filter"
									>
										Clear
									</button>
								) : null}
							</div>
							<button
								type="submit"
								className="ghost icon-button"
								aria-label="Filter collections"
							>
								<IconSearch />
							</button>
						</form>
					</div>
				</div>
				{tableError ? <div className="error-banner">{tableError}</div> : null}
				{tableSuccess ? <div className="muted">{tableSuccess}</div> : null}
				{filteredCollections.length === 0 ? (
					<EmptyState
						title={
							searchTerm
								? `No collections match "${searchTerm}".`
								: "No collections available."
						}
						description={
							searchTerm
								? "Clear the filter to return to the full collection list."
								: "Create a collection to establish ownership, permissions, classes, and objects."
						}
						action={
							searchTerm ? null : (
								<button type="button" onClick={() => setCreateModalOpen(true)}>
									New collection
								</button>
							)
						}
					/>
				) : (
					<div className="responsive-table-region">
						<p className="table-scroll-hint">
							Swipe horizontally to see more columns.
						</p>
						<section className="table-wrap" aria-label="Collections table">
							<table
								id="collections-table"
								className="responsive-data-table collections-data-table"
							>
								<caption className="sr-only">Collections</caption>
								<thead>
									<tr>
										<th className="check-col">
											<input
												type="checkbox"
												aria-label="Select all collections"
												checked={allSelected}
												onChange={(event) =>
													shiftSelect.handleSelectAll(event.target.checked)
												}
											/>
										</th>
										<th className="sortable" aria-sort={getSortAria("id")}>
											<button
												type="button"
												className="table-sort-button"
												onClick={() => setSort("id")}
											>
												ID{renderSortIndicator("id")}
											</button>
										</th>
										<th className="sortable" aria-sort={getSortAria("name")}>
											<button
												type="button"
												className="table-sort-button"
												onClick={() => setSort("name")}
											>
												Name{renderSortIndicator("name")}
											</button>
										</th>
										<th>Parent</th>
										<th>Children</th>
										<th
											className="sortable"
											aria-sort={getSortAria("description")}
										>
											<button
												type="button"
												className="table-sort-button"
												onClick={() => setSort("description")}
											>
												Description{renderSortIndicator("description")}
											</button>
										</th>
									</tr>
								</thead>
								<tbody>
									{filteredCollections.map((collection, index) => {
										const isSelected = selectedCollectionIds.includes(
											collection.id,
										);
										const isFocused = keyboardNav.focusedId === collection.id;
										const depth = depthByCollectionId.get(collection.id) ?? 0;
										const parent =
											collection.parent_collection_id === null ||
											collection.parent_collection_id === undefined
												? null
												: hierarchy.byId.get(collection.parent_collection_id);
										const childCount =
											hierarchy.childrenByParentId.get(collection.id)?.length ??
											0;
										const pathLabel = formatCollectionPath(
											getCollectionPath(collection, hierarchy.byId),
										);
										const rowClassName = [
											isSelected ? "table-row-selected" : "",
											isFocused ? "table-row-focused" : "",
										]
											.filter(Boolean)
											.join(" ");

										return (
											<tr
												key={collection.id}
												className={rowClassName}
												data-table-row-index={index}
											>
												<td className="check-col">
													<input
														type="checkbox"
														aria-label={`Select collection ${collection.name}`}
														checked={isSelected}
														onChange={(event) =>
															shiftSelect.handleClick(
																collection.id,
																event.target.checked,
																(event.nativeEvent as MouseEvent).shiftKey,
															)
														}
													/>
												</td>
												<td>{collection.id}</td>
												<td>
													<Link
														href={`/collections/${collection.id}`}
														className="row-link"
														title={pathLabel}
														style={{
															paddingLeft: depth > 0 ? `${depth * 1.25}rem` : 0,
														}}
													>
														{collection.name}
													</Link>
												</td>
												<td>
													{parent ? (
														<Link
															href={`/collections/${parent.id}`}
															className="row-link"
														>
															{parent.name} (#{parent.id})
														</Link>
													) : (
														<span className="muted">Root</span>
													)}
												</td>
												<td>{childCount}</td>
												<td>{collection.description || "-"}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</section>
					</div>
				)}
				{pageData &&
				(pageData.nextCursor ||
					pageData.prevCursor ||
					pagination.hasPrevPage) ? (
					<TablePagination
						hasNextPage={!!pageData.nextCursor}
						hasPrevPage={pagination.hasPrevPage || !!pageData.prevCursor}
						onNextPage={() =>
							pageData.nextCursor &&
							pagination.goToNextPage(pageData.nextCursor)
						}
						onPrevPage={() =>
							pagination.goToPrevPage(pageData.prevCursor ?? undefined)
						}
						onFirstPage={pagination.goToFirstPage}
						currentCount={collections.length}
						totalCount={pageData.totalCount}
					/>
				) : null}
			</div>
		</div>
	);
}
