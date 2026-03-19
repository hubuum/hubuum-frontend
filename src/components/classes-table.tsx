"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { JsonEditor } from "@/components/json-editor";
import { TablePagination } from "@/components/table-pagination";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1ClassesByClassId,
	getApiV1Classes,
	getApiV1Namespaces,
	postApiV1Classes,
} from "@/lib/api/generated/client";
import type {
	HubuumClassExpanded,
	Namespace,
	NewHubuumClass,
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

type ClassesPageData = {
	classes: HubuumClassExpanded[];
	nextCursor: string | null;
	prevCursor: string | null;
};

async function fetchClasses(
	limit: number,
	cursor?: string,
	sort?: string,
): Promise<ClassesPageData> {
	const response = await getApiV1Classes(
		{ limit, cursor, sort },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	const nextCursor = response.headers.get("X-Next-Cursor");
	const prevCursor = response.headers.get("X-Prev-Cursor");

	return {
		classes: response.data,
		nextCursor,
		prevCursor,
	};
}

async function fetchNamespaces(): Promise<Namespace[]> {
	const response = await getApiV1Namespaces(
		{ limit: 250 },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load namespaces."),
		);
	}

	return response.data;
}

export function ClassesTable() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [namespaceId, setNamespaceId] = useState("");
	const [validateSchema, setValidateSchema] = useState(false);
	const [jsonSchemaInput, setJsonSchemaInput] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
	const [tableError, setTableError] = useState<string | null>(null);
	const [tableSuccess, setTableSuccess] = useState<string | null>(null);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const [searchInput, setSearchInput] = useState(
		searchParams.get("search") ?? "",
	);

	useResizableTable({ tableId: "classes-table", storageKey: "classes" });

	const pagination = useCursorPagination({ defaultLimit: 100 });
	const { sortState, setSort, getSortParam } = useTableSort();

	const classesQuery = useQuery({
		queryKey: ["classes", pagination.cursor, pagination.limit, getSortParam()],
		queryFn: () =>
			fetchClasses(pagination.limit, pagination.cursor, getSortParam()),
	});
	const namespacesQuery = useQuery({
		queryKey: ["namespaces", "class-form"],
		queryFn: fetchNamespaces,
	});
	const namespaces = namespacesQuery.data ?? [];
	const canCreateClass = namespaces.length > 0;

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
		if (namespaceId || !namespaces.length) {
			return;
		}

		setNamespaceId(String(namespaces[0].id));
	}, [namespaceId, namespaces]);

	const createMutation = useMutation({
		mutationFn: async (payload: NewHubuumClass) => {
			const response = await postApiV1Classes(payload, {
				credentials: "include",
			});

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to create class."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["classes"] });
			setName("");
			setDescription("");
			setJsonSchemaInput("");
			setValidateSchema(false);
			setFormError(null);
			setFormSuccess("Class created.");
			setCreateModalOpen(false);
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to create class.",
			);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async (classIds: number[]) => {
			const results = await Promise.all(
				classIds.map(async (id) => {
					const response = await deleteApiV1ClassesByClassId(id, {
						credentials: "include",
					});

					if (response.status !== 204) {
						throw new Error(
							`#${id}: ${getApiErrorMessage(response.data, "Failed to delete class.")}`,
						);
					}
				}),
			);
			return results.length;
		},
		onSuccess: async (count) => {
			await queryClient.invalidateQueries({ queryKey: ["classes"] });
			await queryClient.invalidateQueries({
				queryKey: ["classes", "object-explorer"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["classes", "relations-explorer"],
			});
			setSelectedClassIds([]);
			setTableError(null);
			setTableSuccess(`${count} class${count === 1 ? "" : "es"} deleted.`);
		},
		onError: (error) => {
			setTableSuccess(null);
			setTableError(
				error instanceof Error
					? error.message
					: "Failed to delete selected classes.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		if (!canCreateClass) {
			setFormError(
				"No namespaces available. You need namespace permissions before creating a class.",
			);
			return;
		}

		const parsedNamespaceId = Number.parseInt(namespaceId, 10);
		if (!Number.isFinite(parsedNamespaceId) || parsedNamespaceId < 1) {
			setFormError("Namespace is required.");
			return;
		}

		let parsedJsonSchema: unknown;
		if (jsonSchemaInput.trim()) {
			try {
				parsedJsonSchema = JSON.parse(jsonSchemaInput);
			} catch {
				setFormError("JSON schema is not valid JSON.");
				return;
			}
		}

		const payload: NewHubuumClass = {
			name: name.trim(),
			description: description.trim(),
			namespace_id: parsedNamespaceId,
			validate_schema: validateSchema,
		};

		if (parsedJsonSchema !== undefined) {
			payload.json_schema = parsedJsonSchema;
		}

		createMutation.mutate(payload);
	}

	const pageData = classesQuery.data;
	const classes = pageData?.classes ?? [];
	const searchTerm = normalizeSearchTerm(searchParams.get("search"));
	const filteredClasses = useMemo(
		() =>
			classes.filter((item) =>
				matchesFreeTextSearch(searchTerm, item.name, item.description),
			),
		[classes, searchTerm],
	);
	const allSelected =
		filteredClasses.length > 0 &&
		selectedClassIds.length === filteredClasses.length;

	const shiftSelect = useShiftSelect({
		items: filteredClasses,
		selectedIds: selectedClassIds,
		setSelectedIds: setSelectedClassIds,
		getId: (classItem) => classItem.id,
	});

	const keyboardNav = useTableKeyboardNav({
		items: filteredClasses,
		getId: (classItem) => classItem.id,
		onOpen: (classItem) => router.push(`/classes/${classItem.id}`),
	});

	useEffect(() => {
		if (!selectedClassIds.length) {
			return;
		}

		const existingIds = new Set(filteredClasses.map((item) => item.id));
		setSelectedClassIds((current) => {
			const next = current.filter((id) => existingIds.has(id));
			return next.length === current.length ? current : next;
		});
	}, [filteredClasses, selectedClassIds]);

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "classes") {
				return;
			}

			setCreateModalOpen(true);
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	}, []);

	useEffect(() => {
		const onDeselectAll = () => {
			setSelectedClassIds([]);
		};

		const onSelectAll = () => {
			setSelectedClassIds(filteredClasses.map((classItem) => classItem.id));
		};

		window.addEventListener(DESELECT_ALL_EVENT, onDeselectAll);
		window.addEventListener(SELECT_ALL_EVENT, onSelectAll);
		return () => {
			window.removeEventListener(DESELECT_ALL_EVENT, onDeselectAll);
			window.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
		};
	}, [filteredClasses]);

	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent(SELECTION_STATE_EVENT, {
				detail: {
					count: selectedClassIds.length,
					deleteHandler:
						selectedClassIds.length > 0 ? deleteSelectedClasses : null,
				},
			}),
		);
	}, [selectedClassIds.length]);

	if (classesQuery.isLoading) {
		return <div className="card">Loading classes...</div>;
	}

	if (classesQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load classes.{" "}
				{classesQuery.error instanceof Error
					? classesQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	function deleteSelectedClasses() {
		if (!selectedClassIds.length) {
			return;
		}

		setTableError(null);
		setTableSuccess(null);

		const confirmed = window.confirm(
			`Delete ${selectedClassIds.length} selected class(es)?`,
		);
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate([...selectedClassIds]);
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

	function renderCreateClassForm() {
		return (
			<form className="stack" onSubmit={onSubmit}>
				<div className="form-grid">
					<label className="control-field">
						<span>Name</span>
						<input
							required
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="e.g. server"
						/>
					</label>

					<label className="control-field">
						<span>Namespace</span>
						<select
							required
							value={namespaceId}
							onChange={(event) => setNamespaceId(event.target.value)}
							disabled={!canCreateClass}
						>
							{!canCreateClass ? (
								<option value="">No namespaces available</option>
							) : null}
							{namespaces.map((namespace) => (
								<option key={namespace.id} value={namespace.id}>
									{namespace.name} (#{namespace.id})
								</option>
							))}
						</select>
					</label>

					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							required
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Class description"
						/>
					</label>

					<div className="control-field control-field--wide">
						<JsonEditor
							id="class-create-json-schema"
							label="JSON schema (optional)"
							value={jsonSchemaInput}
							onChange={setJsonSchemaInput}
							placeholder='{"type":"object","properties":{"name":{"type":"string"}}}'
							mode="schema"
							rows={8}
							helperText="Use a JSON Schema object for object validation preview and backend enforcement."
						/>
					</div>

					<label className="control-check">
						<input
							type="checkbox"
							checked={validateSchema}
							onChange={(event) => setValidateSchema(event.target.checked)}
						/>
						<span>Validate objects against JSON schema</span>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions">
					<button
						type="submit"
						disabled={createMutation.isPending || !canCreateClass}
					>
						{createMutation.isPending ? "Creating..." : "Create class"}
					</button>
				</div>
			</form>
		);
	}

	return (
		<div className="stack">
			<CreateModal
				open={isCreateModalOpen}
				title="Create class"
				onClose={() => setCreateModalOpen(false)}
			>
				{renderCreateClassForm()}
			</CreateModal>

			<div className="card table-wrap">
				<div className="table-header">
					<div className="table-title-row">
						<h2>Classes</h2>
						<span className="muted table-count">
							{searchTerm
								? `${filteredClasses.length} shown of ${classes.length}`
								: `${classes.length} loaded`}
							{selectedClassIds.length
								? ` · ${selectedClassIds.length} selected`
								: ""}
						</span>
					</div>
					<div className="table-tools">
						<form className="table-filter-form" onSubmit={onFilterSubmit}>
							<div className="table-filter-field">
								<input
									aria-label="Filter loaded classes"
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
										aria-label="Clear class filter"
									>
										Clear
									</button>
								) : null}
							</div>
							<button
								type="submit"
								className="ghost icon-button"
								aria-label="Filter classes"
							>
								<IconSearch />
							</button>
						</form>
					</div>
				</div>
				{tableError ? <div className="error-banner">{tableError}</div> : null}
				{tableSuccess ? <div className="muted">{tableSuccess}</div> : null}
				{filteredClasses.length === 0 ? (
					<div className="empty-state">
						{searchTerm
							? `No classes match "${searchTerm}".`
							: "No classes available."}
					</div>
				) : (
					<table id="classes-table">
						<thead>
							<tr>
								<th className="check-col">
									<input
										type="checkbox"
										aria-label="Select all classes"
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
								<th
									className="sortable"
									onClick={() => setSort("namespace_id")}
								>
									Namespace{renderSortIndicator("namespace_id")}
								</th>
								<th className="sortable" onClick={() => setSort("description")}>
									Description{renderSortIndicator("description")}
								</th>
							</tr>
						</thead>
						<tbody>
							{filteredClasses.map((item, index) => {
								const isSelected = selectedClassIds.includes(item.id);
								const isFocused = keyboardNav.focusedId === item.id;
								const rowClassName = [
									isSelected ? "table-row-selected" : "",
									isFocused ? "table-row-focused" : "",
								]
									.filter(Boolean)
									.join(" ");

								return (
									<tr
										key={item.id}
										className={rowClassName}
										data-table-row-index={index}
									>
										<td className="check-col">
											<input
												type="checkbox"
												aria-label={`Select class ${item.name}`}
												checked={isSelected}
												onChange={(
													event: React.ChangeEvent<HTMLInputElement>,
												) =>
													shiftSelect.handleClick(
														item.id,
														event.target.checked,
														(event.nativeEvent as MouseEvent).shiftKey,
													)
												}
											/>
										</td>
										<td>{item.id}</td>
										<td>
											<Link href={`/classes/${item.id}`} className="row-link">
												{item.name}
											</Link>
										</td>
										<td>
											{item.namespace.name} (#{item.namespace.id})
										</td>
										<td>{item.description || "-"}</td>
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
						currentCount={classes.length}
						limit={pagination.limit}
					/>
				) : null}
			</div>
		</div>
	);
}
