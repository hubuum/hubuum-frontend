"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CreateModal } from "@/components/create-modal";
import { EmptyState } from "@/components/empty-state";
import { JsonEditor } from "@/components/json-editor";
import { TablePagination } from "@/components/table-pagination";
import { useConfirm } from "@/lib/confirm-context";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1ClassesByClassIdByObjectId,
	getApiV1Classes,
	getApiV1Namespaces,
} from "@/lib/api/generated/client";
import type {
	HubuumClassExpanded,
	HubuumObject,
	Namespace,
	NewHubuumObject,
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
import { useToast } from "@/lib/toast-context";

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

function IconColumns() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M4 5h16v14H4zm2 2v10h3V7zm5 0v10h3V7zm5 0v10h2V7z"
				fill="currentColor"
			/>
		</svg>
	);
}

const OBJECT_DATA_COLUMNS_STORAGE_PREFIX = "hubuum.object-data-columns";
const DEFAULT_SELECTED_DATA_COLUMN_COUNT = 3;
const MAX_SELECTED_DATA_COLUMNS = 6;
const EMPTY_CLASSES: HubuumClassExpanded[] = [];
const EMPTY_NAMESPACES: Namespace[] = [];
const EMPTY_OBJECTS: HubuumObject[] = [];

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ limit: 250 },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	return response.data;
}

async function parseJsonPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

type ObjectsPageData = {
	objects: HubuumObject[];
	nextCursor: string | null;
	prevCursor: string | null;
	totalCount: number | null;
};

async function fetchObjectsByClass(
	classId: number,
	limit: number,
	cursor?: string,
	sort?: string,
): Promise<ObjectsPageData> {
	const params = new URLSearchParams();
	params.set("limit", String(limit));
	if (cursor) params.set("cursor", cursor);
	if (sort) params.set("sort", sort);

	const response = await fetch(
		`/_hubuum-bff/classes/${classId}/objects?${params.toString()}`,
		{
			credentials: "include",
		},
	);
	const payload = await parseJsonPayload(response);

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(payload, "Failed to load objects."));
	}

	const nextCursor = response.headers.get("X-Next-Cursor");
	const prevCursor = response.headers.get("X-Prev-Cursor");
	const totalCountHeader = response.headers.get("X-Total-Count");
	const totalCount = totalCountHeader ? Number.parseInt(totalCountHeader, 10) : null;

	return {
		objects: expectArrayPayload<HubuumObject>(payload, "class objects"),
		nextCursor,
		prevCursor,
		totalCount: Number.isFinite(totalCount) ? totalCount : null,
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

function getDataSearchText(data: unknown): string {
	if (data === null || data === undefined) {
		return "";
	}

	if (typeof data === "string") {
		return data;
	}

	try {
		return JSON.stringify(data);
	} catch {
		return "";
	}
}

function getObjectDataRecord(data: unknown): Record<string, unknown> | null {
	if (data === null || data === undefined || Array.isArray(data)) {
		return null;
	}
	if (typeof data !== "object") {
		return null;
	}
	return data as Record<string, unknown>;
}

function getSchemaPropertyKeys(jsonSchema: unknown): string[] {
	if (!jsonSchema || typeof jsonSchema !== "object" || Array.isArray(jsonSchema)) {
		return [];
	}

	const properties = (jsonSchema as { properties?: unknown }).properties;
	if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
		return [];
	}

	return Object.keys(properties);
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

function formatDataPreviewValue(value: unknown): string {
	if (value === null) {
		return "null";
	}
	if (value === undefined) {
		return "undefined";
	}
	if (typeof value === "string") {
		return value || '""';
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	}
	if (typeof value === "object") {
		const keyCount = Object.keys(value as Record<string, unknown>).length;
		return `${keyCount} key${keyCount === 1 ? "" : "s"}`;
	}
	return String(value);
}

function renderObjectDataPreview(data: unknown, omittedKeys: string[] = []) {
	if (data === null || data === undefined) {
		return <span className="muted">No data</span>;
	}

	if (typeof data !== "object" || Array.isArray(data)) {
		return (
			<span className="object-data-raw" title={getDataSearchText(data)}>
				{formatDataPreviewValue(data)}
			</span>
		);
	}

	const omittedKeySet = new Set(omittedKeys);
	const entries = Object.entries(data as Record<string, unknown>).filter(
		([key]) => !omittedKeySet.has(key),
	);
	if (entries.length === 0) {
		return <span className="muted">No other data</span>;
	}

	const visibleEntries = entries.slice(0, 8);
	const hiddenCount = entries.length - visibleEntries.length;

	return (
		<div className="object-data-preview">
			{visibleEntries.map(([key, value]) => {
				const formattedValue = formatDataPreviewValue(value);
				return (
					<span
						key={key}
						className="object-data-chip"
						title={`${key}: ${formattedValue}`}
					>
						<span className="object-data-key">{key}</span>
						<span className="object-data-value">{formattedValue}</span>
					</span>
				);
			})}
			{hiddenCount > 0 ? (
				<span className="object-data-more">
					+{hiddenCount} more
				</span>
			) : null}
		</div>
	);
}

function renderPromotedDataValue(value: unknown) {
	if (value === undefined || value === null || value === "") {
		return <span className="muted">-</span>;
	}

	const formattedValue = formatDataPreviewValue(value);
	return (
		<span className="object-data-column-value" title={getDataSearchText(value)}>
			{formattedValue}
		</span>
	);
}

export function ObjectsExplorer() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const columnPickerRef = useRef<HTMLDivElement | null>(null);
	const classesQuery = useQuery({
		queryKey: ["classes", "object-explorer"],
		queryFn: fetchClasses,
	});
	const namespacesQuery = useQuery({
		queryKey: ["namespaces", "object-form"],
		queryFn: fetchNamespaces,
	});
	const selectedClassId = searchParams.get("classId") ?? "";
	const [createClassId, setCreateClassId] = useState("");
	const [namespaceId, setNamespaceId] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [dataInput, setDataInput] = useState("{}");
	const [selectedObjectIds, setSelectedObjectIds] = useState<number[]>([]);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const [isColumnPickerOpen, setColumnPickerOpen] = useState(false);
	const [selectedDataColumns, setSelectedDataColumns] = useState<string[]>([]);
	const [searchInput, setSearchInput] = useState(
		searchParams.get("search") ?? "",
	);

	const { showToast } = useToast();

	useResizableTable({ tableId: "objects-table", storageKey: "objects" });

	const pagination = useCursorPagination({ defaultLimit: 100 });
	const { sortState, setSort, getSortParam } = useTableSort();

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
		if (selectedClassId || !classesQuery.data?.length) {
			return;
		}

		const params = new URLSearchParams(searchParams.toString());
		params.set("classId", String(classesQuery.data[0].id));
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname);
	}, [selectedClassId, classesQuery.data, pathname, router, searchParams]);

	const parsedClassId = useMemo(() => {
		const value = Number.parseInt(selectedClassId, 10);
		return Number.isFinite(value) ? value : null;
	}, [selectedClassId]);
	const classes = classesQuery.data ?? EMPTY_CLASSES;
	const namespaces = namespacesQuery.data ?? EMPTY_NAMESPACES;
	const namespaceNameById = useMemo(() => {
		const map = new Map<number, string>();
		for (const namespace of namespaces) {
			map.set(namespace.id, namespace.name);
		}
		for (const classItem of classes) {
			if (!map.has(classItem.namespace.id)) {
				map.set(classItem.namespace.id, classItem.namespace.name);
			}
		}
		return map;
	}, [classes, namespaces]);
	const selectedClass = useMemo(
		() => classes.find((item) => item.id === parsedClassId),
		[classes, parsedClassId],
	);
	const dataColumnStorageKey =
		parsedClassId === null
			? null
			: `${OBJECT_DATA_COLUMNS_STORAGE_PREFIX}:${parsedClassId}`;
	const parsedCreateClassId = useMemo(() => {
		const value = Number.parseInt(createClassId, 10);
		return Number.isFinite(value) ? value : null;
	}, [createClassId]);
	const createSelectedClass = useMemo(
		() => classes.find((item) => item.id === parsedCreateClassId),
		[classes, parsedCreateClassId],
	);

	const objectsQuery = useQuery({
		queryKey: [
			"objects",
			parsedClassId,
			pagination.cursor,
			pagination.limit,
			getSortParam(),
		],
		queryFn: async () =>
			fetchObjectsByClass(
				parsedClassId ?? 0,
				pagination.limit,
				pagination.cursor,
				getSortParam(),
			),
		enabled: parsedClassId !== null,
	});
	const createMutation = useMutation({
		mutationFn: async (payload: NewHubuumObject) => {
			const response = await fetch(
				`/_hubuum-bff/classes/${payload.hubuum_class_id}/objects`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					credentials: "include",
					body: JSON.stringify(payload),
				},
			);
			const responsePayload = await parseJsonPayload(response);

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(responsePayload, "Failed to create object."),
				);
			}

			return payload.hubuum_class_id;
		},
		onSuccess: async (createdClassId) => {
			await queryClient.invalidateQueries({
				queryKey: ["objects", createdClassId],
			});
			setName("");
			setDescription("");
			setDataInput("{}");
			showToast("Object created.", "success");
			setCreateModalOpen(false);
		},
		onError: (error) => {
			showToast(
				error instanceof Error ? error.message : "Failed to create object.",
				"error",
			);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async (payload: { classId: number; objectIds: number[] }) => {
			const results = await Promise.all(
				payload.objectIds.map(async (objectId) => {
					const response = await deleteApiV1ClassesByClassIdByObjectId(
						payload.classId,
						objectId,
						{
							credentials: "include",
						},
					);

					if (response.status !== 204) {
						throw new Error(
							`#${objectId}: ${getApiErrorMessage(response.data, "Failed to delete object.")}`,
						);
					}
				}),
			);
			return { classId: payload.classId, count: results.length };
		},
		onSuccess: async ({ classId: deletedClassId, count }) => {
			await queryClient.invalidateQueries({
				queryKey: ["objects", deletedClassId],
			});
			setSelectedObjectIds([]);
			showToast(`${count} object${count === 1 ? "" : "s"} deleted.`, "success");
		},
		onError: (error) => {
			showToast(
				error instanceof Error
					? error.message
					: "Failed to delete selected objects.",
				"error",
			);
		},
	});

	const deleteSelectedObjects = useCallback(async () => {
		if (!selectedObjectIds.length || parsedClassId === null) {
			return;
		}

		const confirmed = await confirm({
			title: `Delete ${selectedObjectIds.length} selected object${
				selectedObjectIds.length === 1 ? "" : "s"
			}?`,
			description: "This removes the selected objects and cannot be undone.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate({
			classId: parsedClassId,
			objectIds: [...selectedObjectIds],
		});
	}, [confirm, selectedObjectIds, parsedClassId, deleteMutation]);

	useEffect(() => {
		if (!classes.length) {
			setCreateClassId((current) => (current === "" ? current : ""));
			return;
		}

		const hasSelectedCreateClass = classes.some(
			(classItem) => String(classItem.id) === createClassId,
		);
		if (hasSelectedCreateClass) {
			return;
		}

		if (selectedClass) {
			const nextClassId = String(selectedClass.id);
			setCreateClassId((current) =>
				current === nextClassId ? current : nextClassId,
			);
			return;
		}

		const nextClassId = String(classes[0].id);
		setCreateClassId((current) =>
			current === nextClassId ? current : nextClassId,
		);
	}, [classes, createClassId, selectedClass]);

	useEffect(() => {
		if (!namespaces.length) {
			setNamespaceId((current) => (current === "" ? current : ""));
			return;
		}

		const hasSelectedNamespace = namespaces.some(
			(namespace) => String(namespace.id) === namespaceId,
		);
		if (hasSelectedNamespace) {
			return;
		}

		if (createSelectedClass) {
			const classNamespace = namespaces.find(
				(namespace) => namespace.id === createSelectedClass.namespace.id,
			);
			if (classNamespace) {
				const nextNamespaceId = String(classNamespace.id);
				setNamespaceId((current) =>
					current === nextNamespaceId ? current : nextNamespaceId,
				);
				return;
			}
		}

		const nextNamespaceId = String(namespaces[0].id);
		setNamespaceId((current) =>
			current === nextNamespaceId ? current : nextNamespaceId,
		);
	}, [createSelectedClass, namespaceId, namespaces]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: selected object ids must reset when the selected class changes.
	useEffect(() => {
		setSelectedObjectIds((current) => (current.length ? [] : current));
	}, [selectedClassId]);

	const pageData = objectsQuery.data;
	const objects = pageData?.objects ?? EMPTY_OBJECTS;
	const dataColumnCandidates = useMemo(() => {
		const schemaKeys = getSchemaPropertyKeys(selectedClass?.json_schema);
		const counts = new Map<string, number>();
		for (const objectItem of objects) {
			const dataRecord = getObjectDataRecord(objectItem.data);
			if (!dataRecord) {
				continue;
			}
			for (const key of Object.keys(dataRecord)) {
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}

		const schemaKeySet = new Set(schemaKeys);
		const inferredKeys = [...counts.keys()]
			.filter((key) => !schemaKeySet.has(key))
			.sort((left, right) => {
				const countDelta = (counts.get(right) ?? 0) - (counts.get(left) ?? 0);
				return countDelta || left.localeCompare(right);
			});

		return [...schemaKeys, ...inferredKeys].map((key) => ({
			key,
			count: counts.get(key) ?? 0,
			fromSchema: schemaKeySet.has(key),
		}));
	}, [objects, selectedClass?.json_schema]);
	const activeDataColumns = useMemo(() => {
		const candidateKeys = new Set(dataColumnCandidates.map((column) => column.key));
		return selectedDataColumns.filter((key) => candidateKeys.has(key));
	}, [dataColumnCandidates, selectedDataColumns]);
	const searchTerm = normalizeSearchTerm(searchParams.get("search"));
	const filteredObjects = useMemo(
		() =>
			objects.filter((objectItem) =>
				matchesFreeTextSearch(
					searchTerm,
					objectItem.name,
					objectItem.description,
					getDataSearchText(objectItem.data),
				),
			),
		[objects, searchTerm],
	);
	const allSelected =
		filteredObjects.length > 0 &&
		selectedObjectIds.length === filteredObjects.length;

	useEffect(() => {
		if (!dataColumnStorageKey) {
			setSelectedDataColumns((current) => (current.length ? [] : current));
			return;
		}
		if (dataColumnCandidates.length === 0) {
			setSelectedDataColumns((current) => (current.length ? [] : current));
			return;
		}

		try {
			const storedValue = window.localStorage.getItem(dataColumnStorageKey);
			if (storedValue) {
				const parsedValue = JSON.parse(storedValue);
				if (Array.isArray(parsedValue)) {
					const nextColumns = parsedValue
							.filter((value): value is string => typeof value === "string")
						.slice(0, MAX_SELECTED_DATA_COLUMNS);
					setSelectedDataColumns((current) =>
						areStringArraysEqual(current, nextColumns) ? current : nextColumns,
					);
					return;
				}
			}
		} catch {
			// Ignore unavailable or malformed localStorage.
		}

		const nextColumns =
			dataColumnCandidates
				.slice(0, DEFAULT_SELECTED_DATA_COLUMN_COUNT)
			.map((column) => column.key);
		setSelectedDataColumns((current) =>
			areStringArraysEqual(current, nextColumns) ? current : nextColumns,
		);
	}, [dataColumnCandidates, dataColumnStorageKey]);

	useEffect(() => {
		if (!dataColumnStorageKey) {
			return;
		}
		if (dataColumnCandidates.length === 0) {
			return;
		}

		try {
			window.localStorage.setItem(
				dataColumnStorageKey,
				JSON.stringify(selectedDataColumns),
			);
		} catch {
			// Ignore unavailable localStorage.
		}
	}, [dataColumnCandidates.length, dataColumnStorageKey, selectedDataColumns]);

	useEffect(() => {
		if (!isColumnPickerOpen) {
			return;
		}

		function onPointerDown(event: MouseEvent) {
			if (!columnPickerRef.current?.contains(event.target as Node)) {
				setColumnPickerOpen(false);
			}
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setColumnPickerOpen(false);
			}
		}

		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [isColumnPickerOpen]);

	const shiftSelect = useShiftSelect({
		items: filteredObjects,
		selectedIds: selectedObjectIds,
		setSelectedIds: setSelectedObjectIds,
		getId: (objectItem) => objectItem.id,
	});
	const keyboardNav = useTableKeyboardNav({
		items: filteredObjects,
		getId: (objectItem) => objectItem.id,
		onOpen: (objectItem) =>
			router.push(`/objects/${objectItem.hubuum_class_id}/${objectItem.id}`),
	});

	useEffect(() => {
		if (!selectedObjectIds.length) {
			return;
		}

		const existingIds = new Set(
			filteredObjects.map((objectItem) => objectItem.id),
		);
		setSelectedObjectIds((current) => {
			const next = current.filter((objectId) => existingIds.has(objectId));
			return next.length === current.length ? current : next;
		});
	}, [filteredObjects, selectedObjectIds]);

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "objects") {
				return;
			}

			if (selectedClass) {
				setCreateClassId(String(selectedClass.id));
			} else if (classes.length) {
				setCreateClassId(String(classes[0].id));
			} else {
				setCreateClassId("");
			}
			setCreateModalOpen(true);
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	}, [classes, selectedClass]);

	useEffect(() => {
		const onDeselectAll = () => {
			setSelectedObjectIds([]);
		};

		const onSelectAll = () => {
			setSelectedObjectIds(filteredObjects.map((obj) => obj.id));
		};

		window.addEventListener(DESELECT_ALL_EVENT, onDeselectAll);
		window.addEventListener(SELECT_ALL_EVENT, onSelectAll);
		return () => {
			window.removeEventListener(DESELECT_ALL_EVENT, onDeselectAll);
			window.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
		};
	}, [filteredObjects]);

	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent(SELECTION_STATE_EVENT, {
				detail: {
					count: selectedObjectIds.length,
					deleteHandler:
						selectedObjectIds.length > 0 && parsedClassId !== null
							? deleteSelectedObjects
							: null,
				},
			}),
		);
	}, [selectedObjectIds.length, parsedClassId, deleteSelectedObjects]);

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

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!createSelectedClass || parsedCreateClassId === null) {
			showToast("Select a class before creating an object.", "error");
			return;
		}

		const parsedNamespaceId = Number.parseInt(namespaceId, 10);
		if (!Number.isFinite(parsedNamespaceId) || parsedNamespaceId < 1) {
			showToast("Namespace is required.", "error");
			return;
		}

		let parsedData: unknown;
		try {
			parsedData = JSON.parse(dataInput);
		} catch {
			showToast("Object data must be valid JSON.", "error");
			return;
		}

		createMutation.mutate({
			name: name.trim(),
			description: description.trim(),
			data: parsedData,
			hubuum_class_id: createSelectedClass.id,
			namespace_id: parsedNamespaceId,
		});
	}

	function onSubmitShortcut(event: ReactKeyboardEvent<HTMLFormElement>) {
		if (
			event.key !== "Enter" ||
			!event.shiftKey ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		) {
			return;
		}

		const submitButton =
			event.currentTarget.querySelector<HTMLButtonElement>(
				"button[type='submit']:not(:disabled)",
			);
		if (!submitButton) {
			return;
		}

		event.preventDefault();
		event.currentTarget.requestSubmit(submitButton);
	}

	if (classesQuery.isLoading) {
		return <div className="card">Loading class options...</div>;
	}

	if (classesQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load class options.{" "}
				{classesQuery.error instanceof Error
					? classesQuery.error.message
					: "Unknown error"}
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

	function toggleDataColumn(key: string, checked: boolean) {
		setSelectedDataColumns((current) => {
			if (checked) {
				if (current.includes(key)) {
					return current;
				}
				return [...current, key].slice(0, MAX_SELECTED_DATA_COLUMNS);
			}
			return current.filter((currentKey) => currentKey !== key);
		});
	}

	function resetDataColumns() {
		setSelectedDataColumns(
			dataColumnCandidates
				.slice(0, DEFAULT_SELECTED_DATA_COLUMN_COUNT)
				.map((column) => column.key),
		);
	}

	function clearDataColumns() {
		setSelectedDataColumns([]);
	}

	function renderNamespace(value: number): string {
		const namespaceName = namespaceNameById.get(value);
		return namespaceName ? `${namespaceName} (#${value})` : `#${value}`;
	}

	function renderCreateObjectForm() {
		return (
			<form
				className="stack"
				onSubmit={onSubmit}
				onKeyDownCapture={onSubmitShortcut}
			>
				<div className="form-grid">
					<label className="control-field">
						<span>Class</span>
						<select
							required
							value={createClassId}
							onChange={(event) => setCreateClassId(event.target.value)}
							disabled={classes.length === 0}
						>
							{classes.length === 0 ? (
								<option value="">No classes available</option>
							) : null}
							{classes.map((classItem) => (
								<option key={classItem.id} value={classItem.id}>
									{classItem.name} (#{classItem.id})
								</option>
							))}
						</select>
					</label>

					<div className="control-field">
						<span>Namespace</span>
						{namespaces.length > 0 ? (
							<select
								required
								value={namespaceId}
								onChange={(event) => setNamespaceId(event.target.value)}
								disabled={!createSelectedClass}
							>
								{namespaces.map((namespace) => (
									<option key={namespace.id} value={namespace.id}>
										{namespace.name} (#{namespace.id})
									</option>
								))}
							</select>
						) : (
							<input
								required
								type="number"
								min={1}
								value={namespaceId}
								onChange={(event) => setNamespaceId(event.target.value)}
								placeholder={
									namespacesQuery.isLoading
										? "Loading namespaces..."
										: "Enter namespace id"
								}
								disabled={!createSelectedClass || namespacesQuery.isLoading}
							/>
						)}
					</div>

					<label className="control-field">
						<span>Name</span>
						<input
							required
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="e.g. srv-web-01"
							disabled={!createSelectedClass}
						/>
					</label>

					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							required
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Object description"
							disabled={!createSelectedClass}
						/>
					</label>

					<div className="control-field control-field--wide">
						<JsonEditor
							id="object-create-data"
							label="Data (JSON)"
							value={dataInput}
							onChange={setDataInput}
							placeholder='{"hostname":"srv-web-01","env":"prod"}'
							mode="data"
							rows={9}
							disabled={!createSelectedClass}
							validationEnabled={createSelectedClass?.validate_schema ?? false}
							validationSchema={createSelectedClass?.json_schema}
							helperText={
								createSelectedClass?.validate_schema
									? "This class validates object data against its JSON schema."
									: "This class does not currently enforce JSON schema validation."
							}
						/>
					</div>
				</div>

				{namespacesQuery.isError ? (
					<div className="muted">
						Could not load namespaces automatically. Falling back to manual
						namespace ID entry.
					</div>
				) : null}

				<div className="form-actions">
					<button
						type="submit"
						disabled={createMutation.isPending || !createSelectedClass}
					>
						{createMutation.isPending ? "Creating..." : "Create object"}
					</button>
				</div>
			</form>
		);
	}

	return (
		<div className="stack">
			<CreateModal
				open={isCreateModalOpen}
				title="Create object"
				onClose={() => setCreateModalOpen(false)}
			>
				{renderCreateObjectForm()}
			</CreateModal>

			<div className="card table-wrap">
				<div className="table-header">
					<div className="table-title-row">
						<h3>Objects</h3>
						<span className="muted table-count">
							{objectsQuery.data
								? searchTerm
									? `${filteredObjects.length} shown of ${objects.length}`
									: `${objects.length} loaded`
								: parsedClassId
									? "Waiting..."
									: "No class"}
							{selectedObjectIds.length
								? ` · ${selectedObjectIds.length} selected`
								: ""}
						</span>
					</div>
					<div className="table-tools">
						<div className="object-column-picker" ref={columnPickerRef}>
							<button
								type="button"
								className="ghost object-column-picker-trigger"
								onClick={() => setColumnPickerOpen((current) => !current)}
								disabled={dataColumnCandidates.length === 0}
							>
								<IconColumns />
								<span>Data columns</span>
								{activeDataColumns.length ? (
									<span className="object-column-count">
										{activeDataColumns.length}
									</span>
								) : null}
							</button>
							{isColumnPickerOpen ? (
								<div className="object-column-menu card">
									<div className="object-column-menu-header">
										<strong>Show data fields</strong>
										<div className="object-column-menu-actions">
											<button
												type="button"
												className="ghost"
												onClick={resetDataColumns}
											>
												Reset
											</button>
											<button
												type="button"
												className="ghost"
												onClick={clearDataColumns}
											>
												Clear
											</button>
										</div>
									</div>
									{dataColumnCandidates.length === 0 ? (
										<p className="muted">No top-level data fields loaded.</p>
									) : (
										<div className="object-column-options">
											{dataColumnCandidates.map((column) => {
												const checked = selectedDataColumns.includes(
													column.key,
												);
												const disabled =
													!checked &&
													activeDataColumns.length >=
														MAX_SELECTED_DATA_COLUMNS;
												return (
													<label
														key={column.key}
														className="object-column-option"
													>
														<input
															type="checkbox"
															checked={checked}
															disabled={disabled}
															onChange={(event) =>
																toggleDataColumn(
																	column.key,
																	event.target.checked,
																)
															}
														/>
														<span>
															<strong>{column.key}</strong>
															<small>
																{column.fromSchema
																	? "schema"
																	: `${column.count} loaded`}
															</small>
														</span>
													</label>
												);
											})}
										</div>
									)}
								</div>
							) : null}
						</div>
						<form className="table-filter-form" onSubmit={onFilterSubmit}>
							<div className="table-filter-field">
								<input
									aria-label="Filter loaded objects"
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
										aria-label="Clear object filter"
									>
										Clear
									</button>
								) : null}
							</div>
							<button
								type="submit"
								className="ghost icon-button"
								aria-label="Filter objects"
							>
								<IconSearch />
							</button>
						</form>
					</div>
				</div>
				{searchTerm ? (
					<div className="muted">
						Filtering is currently scoped to the selected class.
					</div>
				) : null}

				{parsedClassId === null ? (
					<div className="muted">Select a class to load its objects.</div>
				) : objectsQuery.isLoading ? (
					<div>Loading objects...</div>
				) : objectsQuery.isError ? (
					<div className="error-banner">
						Failed to load objects.{" "}
						{objectsQuery.error instanceof Error
							? objectsQuery.error.message
							: "Unknown error"}
					</div>
				) : filteredObjects.length === 0 ? (
					<EmptyState
						title={
							searchTerm
								? `No objects in this class match "${searchTerm}".`
								: "No objects available in the selected class."
						}
						description={
							searchTerm
								? "Clear the filter to return to the full object list for this class."
								: "Create an object to start populating this class."
						}
						action={
							searchTerm ? null : (
								<button
									type="button"
									onClick={() => setCreateModalOpen(true)}
									disabled={classes.length === 0}
								>
									New object
								</button>
							)
						}
					/>
				) : (
					<table id="objects-table">
						<colgroup>
							<col className="object-select-column" />
							<col className="object-id-column" />
							<col className="object-name-column" />
							<col className="object-namespace-column" />
							<col className="object-description-column" />
							{activeDataColumns.map((columnKey) => (
								<col
									key={columnKey}
									className="object-promoted-data-column"
								/>
							))}
							<col className="object-data-column" />
						</colgroup>
						<thead>
							<tr>
								<th className="check-col">
									<input
										type="checkbox"
										aria-label="Select all objects"
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
								{activeDataColumns.map((columnKey) => (
									<th key={columnKey} className="object-data-field-heading">
										{columnKey}
									</th>
								))}
								<th>Data</th>
							</tr>
						</thead>
						<tbody>
							{filteredObjects.map((objectItem, index) => {
								const isSelected = selectedObjectIds.includes(objectItem.id);
								const isFocused = keyboardNav.focusedId === objectItem.id;
								const rowClassName = [
									isSelected ? "table-row-selected" : "",
									isFocused ? "table-row-focused" : "",
								]
									.filter(Boolean)
									.join(" ");

								return (
								<tr
									key={objectItem.id}
									className={rowClassName}
									data-table-row-index={index}
								>
									<td className="check-col">
										<input
											type="checkbox"
											aria-label={`Select object ${objectItem.name}`}
											checked={isSelected}
											onChange={(event) =>
												shiftSelect.handleClick(
													objectItem.id,
													event.target.checked,
													(event.nativeEvent as MouseEvent).shiftKey,
												)
											}
										/>
									</td>
									<td>{objectItem.id}</td>
									<td>
										<Link
											href={`/objects/${objectItem.hubuum_class_id}/${objectItem.id}`}
											className="row-link"
										>
											{objectItem.name}
										</Link>
									</td>
									<td>{renderNamespace(objectItem.namespace_id)}</td>
									<td>{objectItem.description || "-"}</td>
									{activeDataColumns.map((columnKey) => {
										const dataRecord = getObjectDataRecord(objectItem.data);
										return (
											<td
												key={columnKey}
												className="object-data-field-cell"
											>
												{renderPromotedDataValue(
													dataRecord?.[columnKey],
												)}
											</td>
										);
									})}
									<td className="data-cell">
										{renderObjectDataPreview(
											objectItem.data,
											activeDataColumns,
										)}
									</td>
								</tr>
								);
							})}
						</tbody>
					</table>
				)}
				{pageData && (pageData.nextCursor || pageData.prevCursor || pagination.hasPrevPage) ? (
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
						currentCount={objects.length}
						totalCount={pageData.totalCount}
					/>
				) : null}
			</div>
		</div>
	);
}
