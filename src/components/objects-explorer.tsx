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
import {
	ObjectGroupingMenu,
	type ObjectGroupingField,
} from "@/components/object-grouping-menu";
import {
	ObjectServerFilterMenu,
	type ServerFilterComputedField,
} from "@/components/object-server-filter-menu";
import { TableExportMenu } from "@/components/table-export-menu";
import { TablePagination } from "@/components/table-pagination";
import {
	fetchPersonalComputedFields,
	fetchSharedComputedFields,
} from "@/lib/api/computed-fields";
import { fetchClientPaginationConfig } from "@/lib/api/client-config";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	fetchObjectAggregates,
	type ObjectAggregateSort,
} from "@/lib/api/object-aggregates";
import {
	deleteApiV1ClassesByClassIdByObjectId,
	getApiV1Classes,
	getApiV1Collections,
} from "@/lib/api/generated/client";
import type {
	Collection,
	ComputedFieldDefinition,
	ComputedFieldErrorResponse,
	HubuumClassExpanded,
	HubuumObjectComputedResponse,
	NewHubuumObject,
} from "@/lib/api/generated/models";
import { useConfirm } from "@/lib/confirm-context";
import {
	DESELECT_ALL_EVENT,
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
	SELECT_ALL_EVENT,
	SELECTION_STATE_EVENT,
} from "@/lib/create-events";
import { getDataColumnHeadings } from "@/lib/data-column-headings";
import {
	appendObjectServerFilters,
	OBJECT_SERVER_FILTERS_QUERY_KEY,
	type ObjectComputedResultType,
	type ObjectServerFilter,
	parseObjectServerFilters,
	serializeObjectServerFilters,
	toServerFilterDataPath,
} from "@/lib/object-server-filters";
import {
	formatObjectAggregateDimension,
	groupObjectRows,
	type ObjectGroupSort,
} from "@/lib/object-grouping";
import {
	matchesFreeTextSearch,
	normalizeSearchTerm,
} from "@/lib/resource-search";
import {
	MAX_PAGE_LIMIT_SENTINEL,
	resolveServerPageLimit,
} from "@/lib/server-page-limit";
import type { TableExportColumn, TableExportView } from "@/lib/table-export";
import { useToast } from "@/lib/toast-context";
import { useCursorPagination } from "@/lib/use-cursor-pagination";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";
import { useResizableTable } from "@/lib/use-resizable-table";
import { useShiftSelect } from "@/lib/use-shift-select";
import { useTableKeyboardNav } from "@/lib/use-table-keyboard-nav";
import { useTableSort } from "@/lib/use-table-sort";
import {
	isUserSettingsSyncInitialized,
	writeUserSetting,
} from "@/lib/user-settings-client";
import { PORTABLE_USER_SETTING_KEYS } from "@/lib/user-settings-types";

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

function IconDataField() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2.25" y="3" width="11.5" height="10" rx="2" />
			<path d="M6 3.5v9M10 3.5v9" />
		</svg>
	);
}

function IconSharedComputedField() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="5.25" cy="5" r="2" />
			<circle cx="11.25" cy="5.75" r="1.5" />
			<path d="M1.75 13c.3-2.9 1.55-4.5 3.5-4.5s3.2 1.6 3.5 4.5M9.25 9.25c2.65-.65 4.3.7 4.75 3.25" />
		</svg>
	);
}

function IconPersonalComputedField() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="8" cy="5" r="2.25" />
			<path d="M3.5 13c.35-3 1.85-4.5 4.5-4.5s4.15 1.5 4.5 4.5" />
		</svg>
	);
}

function IconConnections() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10.6 13.4a1 1 0 0 1 0-1.4l2.8-2.8a3 3 0 1 1 4.2 4.2l-2.1 2.1a3 3 0 0 1-4.2 0 1 1 0 1 1 1.4-1.4 1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 1 0-1.4-1.4L12 13.4a1 1 0 0 1-1.4 0Zm2.8-2.8a1 1 0 0 1 0 1.4l-2.8 2.8a3 3 0 1 1-4.2-4.2l2.1-2.1a3 3 0 0 1 4.2 0 1 1 0 1 1-1.4 1.4 1 1 0 0 0-1.4 0L7.8 12a1 1 0 1 0 1.4 1.4l2.8-2.8a1 1 0 0 1 1.4 0Z"
				fill="currentColor"
			/>
		</svg>
	);
}

const DEFAULT_SELECTED_DATA_COLUMN_COUNT = 3;
const MAX_SELECTED_DATA_COLUMNS = 6;
const MAX_DATA_PATH_DEPTH = 5;
const MAX_DATA_ARRAY_ITEMS = 3;
const CUSTOM_DATA_FIELD_ID_PREFIX = "custom:";
const OBJECT_FETCH_LIMIT_OPTIONS = [
	{ label: "50", value: 50 },
	{ label: "100", value: 100 },
	{ label: "250", value: 250 },
	{ label: "MAX", value: MAX_PAGE_LIMIT_SENTINEL },
] as const;
const EMPTY_CLASSES: HubuumClassExpanded[] = [];
const EMPTY_NAMESPACES: Collection[] = [];
const EMPTY_OBJECTS: HubuumObjectComputedResponse[] = [];

type DataPathCandidate = {
	id: string;
	path: string[];
	label: string;
	count: number;
	fromSchema: boolean;
};

type CustomDataField = {
	id: string;
	label: string;
	expression: string;
	paths: string[][];
	scope: "user";
};

type ActiveDataColumn = {
	id: string;
	label: string;
	paths: string[][];
	source: "data" | "custom";
};

type DataPreviewEntry = {
	id: string;
	path: string[];
	value: unknown;
};

type DataColumnSortState = {
	columnId: string | null;
	direction: "asc" | "desc";
};

type ComputedColumn = {
	id: string;
	key: string;
	label: string;
	scope: "shared" | "personal";
	resultType: ObjectComputedResultType;
};

type ResolvedObjectGroupingField = ObjectGroupingField & {
	getValue: (objectItem: HubuumObjectComputedResponse) => unknown;
};

type DisplayedAggregateGroup = {
	id: string;
	label: string;
	count: number;
	rows?: HubuumObjectComputedResponse[];
};

const FIRST_AGGREGATE_PAGE = "__first_aggregate_page__";

function toObjectAggregateSort(sort: ObjectGroupSort): ObjectAggregateSort {
	if (sort === "count-asc") return "object_count.asc";
	if (sort === "count-desc") return "object_count.desc";
	if (sort === "value-desc") return "dimensions.desc";
	return "dimensions.asc";
}

function normalizeComputedResultType(
	value: string,
): ObjectComputedResultType | null {
	if (
		value === "string" ||
		value === "number" ||
		value === "integer" ||
		value === "boolean" ||
		value === "object" ||
		value === "array"
	) {
		return value;
	}
	return null;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ limit: 250, include_total: false },
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
	objects: HubuumObjectComputedResponse[];
	nextCursor: string | null;
	prevCursor: string | null;
	totalCount: number | null;
};

async function fetchObjectsByClass(
	classId: number,
	limit: number,
	cursor?: string,
	sort?: string,
	serverFilters: readonly ObjectServerFilter[] = [],
): Promise<ObjectsPageData> {
	const params = new URLSearchParams();
	params.set("limit", String(resolveServerPageLimit(limit)));
	params.set("include", "computed");
	if (cursor) params.set("cursor", cursor);
	if (sort) params.set("sort", sort);
	appendObjectServerFilters(params, serverFilters);

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
	const totalCount = totalCountHeader
		? Number.parseInt(totalCountHeader, 10)
		: null;

	return {
		objects: expectArrayPayload<HubuumObjectComputedResponse>(
			payload,
			"class objects",
		),
		nextCursor,
		prevCursor,
		totalCount: Number.isFinite(totalCount) ? totalCount : null,
	};
}

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections(
		{ limit: 250, include_total: false },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
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

function getComputedColumnResult(
	objectItem: HubuumObjectComputedResponse,
	column: ComputedColumn,
): { error: ComputedFieldErrorResponse | null; value: unknown } {
	const computed =
		column.scope === "shared"
			? objectItem.computed.shared
			: objectItem.computed.personal;
	return {
		error: computed?.errors[column.key] ?? null,
		value: computed?.values[column.key],
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getDataPathId(path: string[]): string {
	return JSON.stringify(path);
}

function parseDataPathId(value: string): string[] | null {
	try {
		const parsedValue = JSON.parse(value);
		if (
			Array.isArray(parsedValue) &&
			parsedValue.every((item) => typeof item === "string")
		) {
			return parsedValue;
		}
	} catch {
		// Existing stored preferences used plain top-level keys.
	}

	return value ? [value] : null;
}

function escapeDataPathSegment(segment: string): string {
	return segment.replaceAll("\\", "\\\\").replaceAll(".", "\\.");
}

function formatDataPathLabel(path: string[]): string {
	return path.reduce((label, segment) => {
		if (segment.startsWith("[")) {
			return `${label}${segment}`;
		}
		const escapedSegment = escapeDataPathSegment(segment);
		return label ? `${label}.${escapedSegment}` : escapedSegment;
	}, "");
}

function splitEscapedExpression(value: string, separator: string): string[] {
	const parts: string[] = [];
	let current = "";
	let escaped = false;

	for (const character of value) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (character === separator) {
			parts.push(current);
			current = "";
			continue;
		}
		current += character;
	}

	if (escaped) {
		current += "\\";
	}
	parts.push(current);
	return parts;
}

function expandArraySegments(segment: string): string[] {
	const parts: string[] = [];
	let remaining = segment;
	const arraySegmentPattern = /^(.*?)(\[(\d+)])$/;

	while (remaining) {
		const match = remaining.match(arraySegmentPattern);
		if (!match) {
			parts.unshift(remaining);
			break;
		}

		parts.unshift(match[2]);
		remaining = match[1];
	}

	return parts.filter(Boolean);
}

function parseDataPathExpression(value: string): string[] | null {
	const segments = splitEscapedExpression(value.trim(), ".")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.flatMap(expandArraySegments);

	return segments.length ? segments : null;
}

function parseCustomDataFieldExpression(value: string): string[][] {
	const seen = new Set<string>();
	const paths: string[][] = [];
	for (const pathExpression of splitEscapedExpression(value, "|")) {
		const path = parseDataPathExpression(pathExpression);
		if (!path) {
			continue;
		}
		const id = getDataPathId(path);
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		paths.push(path);
	}
	return paths;
}

function getValueAtDataPath(data: unknown, path: string[]): unknown {
	let current = data;
	for (const segment of path) {
		const arrayIndexMatch = segment.match(/^\[(\d+)\]$/);
		if (arrayIndexMatch) {
			if (!Array.isArray(current)) {
				return undefined;
			}
			current = current[Number.parseInt(arrayIndexMatch[1], 10)];
			continue;
		}

		if (!isPlainObject(current) || !(segment in current)) {
			return undefined;
		}
		current = current[segment];
	}
	return current;
}

function isEmptyDataValue(value: unknown): boolean {
	return value === undefined || value === null || value === "";
}

function getValueAtFirstAvailableDataPath(
	data: unknown,
	paths: string[][],
): unknown {
	for (const path of paths) {
		const value = getValueAtDataPath(data, path);
		if (!isEmptyDataValue(value)) {
			return value;
		}
	}
	return undefined;
}

function getComparableDataValue(
	value: unknown,
): string | number | boolean | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	return JSON.stringify(value);
}

function compareDataColumnValues(
	left: unknown,
	right: unknown,
	direction: DataColumnSortState["direction"],
): number {
	const leftValue = getComparableDataValue(left);
	const rightValue = getComparableDataValue(right);
	if (leftValue === null && rightValue === null) {
		return 0;
	}
	if (leftValue === null) {
		return 1;
	}
	if (rightValue === null) {
		return -1;
	}

	const directionMultiplier = direction === "asc" ? 1 : -1;
	if (typeof leftValue === "number" && typeof rightValue === "number") {
		return (leftValue - rightValue) * directionMultiplier;
	}

	if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
		return (Number(leftValue) - Number(rightValue)) * directionMultiplier;
	}

	return (
		String(leftValue).localeCompare(String(rightValue), undefined, {
			numeric: true,
			sensitivity: "base",
		}) * directionMultiplier
	);
}

function getSchemaPropertyPaths(
	jsonSchema: unknown,
	parentPath: string[] = [],
	depth = 1,
): string[][] {
	if (
		!jsonSchema ||
		typeof jsonSchema !== "object" ||
		Array.isArray(jsonSchema)
	) {
		return [];
	}

	const properties = (jsonSchema as { properties?: unknown }).properties;
	if (
		!properties ||
		typeof properties !== "object" ||
		Array.isArray(properties)
	) {
		return [];
	}

	const paths: string[][] = [];
	for (const [key, propertySchema] of Object.entries(
		properties as Record<string, unknown>,
	)) {
		const path = [...parentPath, key];
		const childPaths =
			depth < MAX_DATA_PATH_DEPTH
				? getSchemaPropertyPaths(propertySchema, path, depth + 1)
				: [];
		if (childPaths.length > 0) {
			paths.push(...childPaths);
		} else {
			paths.push(path);
		}
	}

	return paths;
}

function incrementDataPathCount(counts: Map<string, number>, path: string[]) {
	const id = getDataPathId(path);
	counts.set(id, (counts.get(id) ?? 0) + 1);
}

function collectDataPaths(
	value: unknown,
	counts: Map<string, number>,
	parentPath: string[] = [],
	depth = 0,
) {
	if (Array.isArray(value)) {
		if (depth >= MAX_DATA_PATH_DEPTH || value.length === 0) {
			incrementDataPathCount(counts, parentPath);
			return;
		}

		for (const [index, childValue] of value
			.slice(0, MAX_DATA_ARRAY_ITEMS)
			.entries()) {
			const path = [...parentPath, `[${index}]`];
			if (isPlainObject(childValue) || Array.isArray(childValue)) {
				collectDataPaths(childValue, counts, path, depth + 1);
			} else {
				incrementDataPathCount(counts, path);
			}
		}
		return;
	}

	if (!isPlainObject(value)) {
		return;
	}

	for (const [key, childValue] of Object.entries(value)) {
		const path = [...parentPath, key];

		if (
			depth < MAX_DATA_PATH_DEPTH &&
			(isPlainObject(childValue) || Array.isArray(childValue))
		) {
			collectDataPaths(childValue, counts, path, depth + 1);
			continue;
		}

		incrementDataPathCount(counts, path);
	}
}

function isSameOrChildPath(path: string[], maybeParentPath: string[]): boolean {
	if (maybeParentPath.length > path.length) {
		return false;
	}
	return maybeParentPath.every((segment, index) => segment === path[index]);
}

function isOmittedDataPath(path: string[], omittedPaths: string[][]): boolean {
	return omittedPaths.some((omittedPath) =>
		isSameOrChildPath(path, omittedPath),
	);
}

function collectDataPreviewEntries(
	value: unknown,
	omittedPaths: string[][],
	parentPath: string[] = [],
	depth = 0,
): DataPreviewEntry[] {
	if (Array.isArray(value)) {
		if (depth >= MAX_DATA_PATH_DEPTH || value.length === 0) {
			return parentPath.length
				? [{ id: getDataPathId(parentPath), path: parentPath, value }]
				: [];
		}

		return value.slice(0, MAX_DATA_ARRAY_ITEMS).flatMap((childValue, index) => {
			const path = [...parentPath, `[${index}]`];
			if (isOmittedDataPath(path, omittedPaths)) {
				return [];
			}
			if (isPlainObject(childValue) || Array.isArray(childValue)) {
				const childEntries = collectDataPreviewEntries(
					childValue,
					omittedPaths,
					path,
					depth + 1,
				);
				return childEntries.length > 0
					? childEntries
					: [{ id: getDataPathId(path), path, value: childValue }];
			}
			return [{ id: getDataPathId(path), path, value: childValue }];
		});
	}

	if (!isPlainObject(value)) {
		return [];
	}

	const entries: DataPreviewEntry[] = [];
	for (const [key, childValue] of Object.entries(value)) {
		const path = [...parentPath, key];
		if (isOmittedDataPath(path, omittedPaths)) {
			continue;
		}

		if (
			depth < MAX_DATA_PATH_DEPTH &&
			(isPlainObject(childValue) || Array.isArray(childValue))
		) {
			const childEntries = collectDataPreviewEntries(
				childValue,
				omittedPaths,
				path,
				depth + 1,
			);
			if (childEntries.length > 0) {
				entries.push(...childEntries);
			} else {
				entries.push({ id: getDataPathId(path), path, value: childValue });
			}
			continue;
		}

		entries.push({ id: getDataPathId(path), path, value: childValue });
	}

	return entries;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

function normalizeCustomDataField(value: unknown): CustomDataField | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const field = value as {
		id?: unknown;
		label?: unknown;
		expression?: unknown;
		scope?: unknown;
	};
	if (
		typeof field.id !== "string" ||
		!field.id.startsWith(CUSTOM_DATA_FIELD_ID_PREFIX) ||
		typeof field.label !== "string" ||
		typeof field.expression !== "string"
	) {
		return null;
	}

	const label = field.label.trim();
	const expression = field.expression.trim();
	const paths = parseCustomDataFieldExpression(expression);
	if (!label || paths.length === 0) {
		return null;
	}

	return {
		id: field.id,
		label,
		expression,
		paths,
		scope: "user",
	};
}

function persistCustomDataFields(
	storageKey: string | null,
	fields: CustomDataField[],
): boolean {
	if (!storageKey || typeof window === "undefined") {
		return false;
	}

	try {
		return writeUserSetting(storageKey, JSON.stringify(fields));
	} catch {
		return false;
	}
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

function renderObjectDataPreview(data: unknown, omittedPaths: string[][] = []) {
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

	const previewEntries = collectDataPreviewEntries(data, omittedPaths);
	if (previewEntries.length === 0) {
		return <span className="muted">No other data</span>;
	}

	const visibleEntries = previewEntries.slice(0, 10);
	const hiddenCount = previewEntries.length - visibleEntries.length;

	return (
		<div className="object-data-preview">
			{visibleEntries.map((entry) => {
				const formattedLabel = formatDataPathLabel(entry.path);
				const formattedValue = formatDataPreviewValue(entry.value);
				return (
					<span
						key={entry.id}
						className="object-data-chip"
						title={`${formattedLabel}: ${formattedValue}`}
					>
						<span className="object-data-key">{formattedLabel}</span>
						<span className="object-data-value">{formattedValue}</span>
					</span>
				);
			})}
			{hiddenCount > 0 ? (
				<span className="object-data-more">+{hiddenCount} more</span>
			) : null}
		</div>
	);
}

function renderPromotedDataValue(value: unknown) {
	if (isEmptyDataValue(value)) {
		return <span className="muted">-</span>;
	}

	if (isPlainObject(value)) {
		const childEntries = collectDataPreviewEntries(value, []);
		if (childEntries.length === 0) {
			return <span className="muted">Empty object</span>;
		}

		const visibleEntries = childEntries.slice(0, 3);
		const hiddenCount = childEntries.length - visibleEntries.length;
		const previewText = visibleEntries
			.map((entry) => {
				const label = formatDataPathLabel(entry.path);
				return `${label}: ${formatDataPreviewValue(entry.value)}`;
			})
			.join("; ");

		return (
			<span
				className="object-data-column-value"
				title={getDataSearchText(value)}
			>
				{previewText}
				{hiddenCount > 0 ? `; +${hiddenCount} more` : ""}
			</span>
		);
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
	const collectionsQuery = useQuery({
		queryKey: ["collections", "object-form"],
		queryFn: fetchCollections,
	});
	const selectedClassId = searchParams.get("classId") ?? "";
	const groupingClassIdRef = useRef(selectedClassId);
	const [createClassId, setCreateClassId] = useState("");
	const [collectionId, setCollectionId] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [dataInput, setDataInput] = useState("{}");
	const [selectedObjectIds, setSelectedObjectIds] = useState<number[]>([]);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);
	const [isColumnPickerOpen, setColumnPickerOpen] = useState(false);
	const [selectedDataColumns, setSelectedDataColumns] = useState<string[]>([]);
	const [hiddenComputedColumnIds, setHiddenComputedColumnIds] = useState<
		string[]
	>([]);
	const [
		loadedHiddenComputedColumnsStorageKey,
		setLoadedHiddenComputedColumnsStorageKey,
	] = useState<string | null>(null);
	const [showRawDataColumn, setShowRawDataColumn] = useState(true);
	const [customDataFields, setCustomDataFields] = useState<CustomDataField[]>(
		[],
	);
	const [
		loadedCustomDataFieldsStorageKey,
		setLoadedCustomDataFieldsStorageKey,
	] = useState<string | null>(null);
	const [customDataFieldLabel, setCustomDataFieldLabel] = useState("");
	const [customDataFieldExpression, setCustomDataFieldExpression] =
		useState("");
	const [dataColumnSort, setDataColumnSort] = useState<DataColumnSortState>({
		columnId: null,
		direction: "asc",
	});
	const [groupFieldId, setGroupFieldId] = useState<string | null>(null);
	const [groupSort, setGroupSort] = useState<ObjectGroupSort>("count-desc");
	const [aggregateCursor, setAggregateCursor] = useState<string | null>(null);
	const [aggregateCursorHistory, setAggregateCursorHistory] = useState<
		string[]
	>([]);
	const [searchInput, setSearchInput] = useState(
		searchParams.get("search") ?? "",
	);
	const serverFilters = useMemo(
		() =>
			parseObjectServerFilters(
				searchParams.get(OBJECT_SERVER_FILTERS_QUERY_KEY),
			),
		[searchParams],
	);
	const serverFilterSignature = useMemo(
		() => serializeObjectServerFilters(serverFilters),
		[serverFilters],
	);

	const { showToast } = useToast();

	const pagination = useCursorPagination({ defaultLimit: 100 });
	const { sortState, setSort, clearSort, getSortParam } = useTableSort();
	const clientPaginationQuery = useQuery({
		queryKey: ["client-config", "pagination"],
		queryFn: fetchClientPaginationConfig,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const effectiveFetchLimit = resolveServerPageLimit(
		pagination.limit,
		clientPaginationQuery.data?.max_page_limit,
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
	useEffect(() => {
		if (groupingClassIdRef.current === selectedClassId) return;
		groupingClassIdRef.current = selectedClassId;
		setGroupFieldId(null);
	}, [selectedClassId]);
	const classes = classesQuery.data ?? EMPTY_CLASSES;
	const collections = collectionsQuery.data ?? EMPTY_NAMESPACES;
	const collectionNameById = useMemo(() => {
		const map = new Map<number, string>();
		for (const collection of collections) {
			map.set(collection.id, collection.name);
		}
		for (const classItem of classes) {
			if (!map.has(classItem.collection.id)) {
				map.set(classItem.collection.id, classItem.collection.name);
			}
		}
		return map;
	}, [classes, collections]);
	const selectedClass = useMemo(
		() => classes.find((item) => item.id === parsedClassId),
		[classes, parsedClassId],
	);
	const dataColumnStorageKey =
		parsedClassId === null
			? null
			: PORTABLE_USER_SETTING_KEYS.objectDataColumns(parsedClassId);
	const hiddenComputedColumnsStorageKey =
		parsedClassId === null
			? null
			: PORTABLE_USER_SETTING_KEYS.objectHiddenComputedColumns(parsedClassId);
	const rawDataColumnStorageKey =
		parsedClassId === null
			? null
			: PORTABLE_USER_SETTING_KEYS.objectRawDataColumn(parsedClassId);
	const customDataFieldsStorageKey =
		parsedClassId === null
			? null
			: PORTABLE_USER_SETTING_KEYS.objectCustomDataFields(parsedClassId);
	const customDataFieldsReady =
		loadedCustomDataFieldsStorageKey === customDataFieldsStorageKey;
	const parsedCreateClassId = useMemo(() => {
		const value = Number.parseInt(createClassId, 10);
		return Number.isFinite(value) ? value : null;
	}, [createClassId]);
	const createSelectedClass = useMemo(
		() => classes.find((item) => item.id === parsedCreateClassId),
		[classes, parsedCreateClassId],
	);
	const sharedComputedQuery = useQuery({
		queryKey: ["computed-fields", "shared", parsedClassId],
		queryFn: () => fetchSharedComputedFields(parsedClassId ?? 0),
		enabled: parsedClassId !== null,
	});
	const personalComputedQuery = useQuery({
		queryKey: ["computed-fields", "personal", parsedClassId],
		queryFn: () => fetchPersonalComputedFields(parsedClassId ?? 0),
		enabled: parsedClassId !== null,
	});
	const computedColumns = useMemo<ComputedColumn[]>(() => {
		function columnsFor(
			definitions: ComputedFieldDefinition[],
			scope: ComputedColumn["scope"],
		): ComputedColumn[] {
			return definitions.flatMap((definition) => {
				const resultType = normalizeComputedResultType(definition.result_type);
				return definition.enabled && resultType
					? [
							{
								id: `${scope}:${definition.key}`,
								key: definition.key,
								label: definition.label,
								scope,
								resultType,
							},
						]
					: [];
			});
		}

		return [
			...columnsFor(sharedComputedQuery.data?.definitions ?? [], "shared"),
			...columnsFor(personalComputedQuery.data ?? [], "personal"),
		];
	}, [personalComputedQuery.data, sharedComputedQuery.data?.definitions]);
	const activeComputedColumns = useMemo(
		() =>
			computedColumns.filter(
				(column) => !hiddenComputedColumnIds.includes(column.id),
			),
		[computedColumns, hiddenComputedColumnIds],
	);

	const objectsQuery = useQuery({
		queryKey: [
			"objects",
			parsedClassId,
			pagination.cursor,
			effectiveFetchLimit,
			getSortParam(),
			serverFilterSignature,
		],
		queryFn: async () =>
			fetchObjectsByClass(
				parsedClassId ?? 0,
				effectiveFetchLimit,
				pagination.cursor,
				getSortParam(),
				serverFilters,
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
			await queryClient.invalidateQueries({
				queryKey: ["object-aggregates", createdClassId],
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
			await queryClient.invalidateQueries({
				queryKey: ["object-aggregates", deletedClassId],
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
		if (!collections.length) {
			setCollectionId((current) => (current === "" ? current : ""));
			return;
		}

		const hasSelectedCollection = collections.some(
			(collection) => String(collection.id) === collectionId,
		);
		if (hasSelectedCollection) {
			return;
		}

		if (createSelectedClass) {
			const classCollection = collections.find(
				(collection) => collection.id === createSelectedClass.collection.id,
			);
			if (classCollection) {
				const nextCollectionId = String(classCollection.id);
				setCollectionId((current) =>
					current === nextCollectionId ? current : nextCollectionId,
				);
				return;
			}
		}

		const nextCollectionId = String(collections[0].id);
		setCollectionId((current) =>
			current === nextCollectionId ? current : nextCollectionId,
		);
	}, [createSelectedClass, collectionId, collections]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: selected object ids must reset when the server result scope changes.
	useEffect(() => {
		setSelectedObjectIds((current) => (current.length ? [] : current));
	}, [selectedClassId, serverFilterSignature]);

	const pageData = objectsQuery.data;
	const objects = pageData?.objects ?? EMPTY_OBJECTS;
	const dataColumnCandidates = useMemo<DataPathCandidate[]>(() => {
		const schemaPaths = getSchemaPropertyPaths(selectedClass?.json_schema);
		const counts = new Map<string, number>();
		for (const objectItem of objects) {
			collectDataPaths(objectItem.data, counts);
		}

		const schemaIds = schemaPaths.map(getDataPathId);
		const schemaIdSet = new Set(schemaIds);
		const inferredKeys = [...counts.keys()]
			.filter((key) => !schemaIdSet.has(key))
			.sort((left, right) => {
				const countDelta = (counts.get(right) ?? 0) - (counts.get(left) ?? 0);
				return countDelta || left.localeCompare(right);
			});

		return [...schemaIds, ...inferredKeys]
			.map((id) => {
				const path = parseDataPathId(id);
				if (!path) {
					return null;
				}
				return {
					id,
					path,
					label: formatDataPathLabel(path),
					count: counts.get(id) ?? 0,
					fromSchema: schemaIdSet.has(id),
				};
			})
			.filter((candidate): candidate is DataPathCandidate =>
				Boolean(candidate),
			);
	}, [objects, selectedClass?.json_schema]);
	const activeDataColumns = useMemo<ActiveDataColumn[]>(() => {
		const candidatesById = new Map(
			dataColumnCandidates.map((column) => [column.id, column]),
		);
		const customFieldsById = new Map(
			customDataFields.map((field) => [field.id, field]),
		);
		return selectedDataColumns
			.map((columnId) => {
				const candidate = candidatesById.get(columnId);
				if (candidate) {
					return {
						id: candidate.id,
						label: candidate.label,
						paths: [candidate.path],
						source: "data" as const,
					};
				}

				const customField = customFieldsById.get(columnId);
				if (customField) {
					return {
						id: customField.id,
						label: customField.label,
						paths: customField.paths,
						source: "custom" as const,
					};
				}

				return null;
			})
			.filter((column): column is ActiveDataColumn => column !== null);
	}, [customDataFields, dataColumnCandidates, selectedDataColumns]);
	const dataColumnHeadings = useMemo(
		() => getDataColumnHeadings(activeDataColumns),
		[activeDataColumns],
	);
	const sortedDataColumnCandidates = useMemo(
		() =>
			[...dataColumnCandidates].sort((left, right) =>
				left.label.localeCompare(right.label),
			),
		[dataColumnCandidates],
	);
	const serverFilterDataFields = useMemo(
		() =>
			sortedDataColumnCandidates
				.map((column) => {
					const path = toServerFilterDataPath(column.path);
					return path
						? {
								id: column.id,
								label: column.label,
								path,
							}
						: null;
				})
				.filter(
					(column): column is NonNullable<typeof column> => column !== null,
				),
		[sortedDataColumnCandidates],
	);
	const serverFilterComputedFields = useMemo<ServerFilterComputedField[]>(
		() =>
			computedColumns.map((column) => ({
				id: column.id,
				key: column.key,
				label: column.label,
				scope: column.scope,
				resultType: column.resultType,
			})),
		[computedColumns],
	);
	const groupingFields = useMemo<ResolvedObjectGroupingField[]>(() => {
		const fields: ResolvedObjectGroupingField[] = [
			{
				id: "object:collection",
				label: "Collection",
				section: "Object fields",
				serverGroupBy: "collection_id",
				getValue: (objectItem) => {
					const collectionName = collectionNameById.get(
						objectItem.collection_id,
					);
					return collectionName
						? `${collectionName} (#${objectItem.collection_id})`
						: `#${objectItem.collection_id}`;
				},
			},
			{
				id: "object:name",
				label: "Name",
				section: "Object fields",
				serverGroupBy: "name",
				getValue: (objectItem) => objectItem.name,
			},
			{
				id: "object:description",
				label: "Description",
				section: "Object fields",
				serverGroupBy: "description",
				getValue: (objectItem) => objectItem.description,
			},
			{
				id: "object:created-at",
				label: "Created at",
				section: "Object fields",
				serverGroupBy: "created_at",
				getValue: (objectItem) => objectItem.created_at,
			},
			{
				id: "object:updated-at",
				label: "Updated at",
				section: "Object fields",
				serverGroupBy: "updated_at",
				getValue: (objectItem) => objectItem.updated_at,
			},
		];

		for (const column of sortedDataColumnCandidates) {
			const serverPath = toServerFilterDataPath(column.path);
			fields.push({
				id: `data:${column.id}`,
				label: column.label,
				section: "Data fields",
				serverGroupBy: serverPath
					? `json_data.${serverPath.join(",")}`
					: undefined,
				getValue: (objectItem) =>
					getValueAtDataPath(objectItem.data, column.path),
			});
		}
		if (
			groupFieldId?.startsWith("data:") &&
			!fields.some((field) => field.id === groupFieldId)
		) {
			const path = parseDataPathId(groupFieldId.slice("data:".length));
			if (path) {
				fields.push({
					id: groupFieldId,
					label: formatDataPathLabel(path),
					section: "Data fields",
					serverGroupBy: toServerFilterDataPath(path)
						? `json_data.${toServerFilterDataPath(path)?.join(",")}`
						: undefined,
					getValue: (objectItem) => getValueAtDataPath(objectItem.data, path),
				});
			}
		}
		for (const field of [...customDataFields].sort((left, right) =>
			left.label.localeCompare(right.label),
		)) {
			fields.push({
				id: `custom:${field.id}`,
				label: field.label,
				section: "Custom fields",
				getValue: (objectItem) =>
					getValueAtFirstAvailableDataPath(objectItem.data, field.paths),
			});
		}
		for (const column of [...computedColumns].sort((left, right) =>
			left.label.localeCompare(right.label),
		)) {
			fields.push({
				id: `computed:${column.id}`,
				label: `${column.scope === "shared" ? "Shared" : "Personal"} · ${column.label}`,
				section: "Computed fields",
				serverGroupBy: `computed.${column.scope}.${column.key}`,
				getValue: (objectItem) =>
					getComputedColumnResult(objectItem, column).value,
			});
		}

		return fields;
	}, [
		collectionNameById,
		computedColumns,
		customDataFields,
		groupFieldId,
		sortedDataColumnCandidates,
	]);
	const columnMenuWidth = useMemo(() => {
		const standardLength = dataColumnCandidates.reduce(
			(maxLength, column) => Math.max(maxLength, column.label.length),
			0,
		);
		const customLength = customDataFields.reduce(
			(maxLength, field) =>
				Math.max(maxLength, field.label.length, field.expression.length),
			0,
		);
		const widthCh = Math.max(
			34,
			Math.min(96, Math.max(standardLength, customLength) + 14),
		);
		return `${widthCh}ch`;
	}, [customDataFields, dataColumnCandidates]);
	const searchTerm = normalizeSearchTerm(searchParams.get("search"));
	const filteredObjects = useMemo(
		() =>
			objects.filter((objectItem) =>
				matchesFreeTextSearch(
					searchTerm,
					objectItem.name,
					objectItem.description,
					getDataSearchText(objectItem.data),
					getDataSearchText(objectItem.computed.shared.values),
					getDataSearchText(objectItem.computed.personal?.values),
				),
			),
		[objects, searchTerm],
	);
	const activeGroupingField = useMemo(
		() => groupingFields.find((field) => field.id === groupFieldId) ?? null,
		[groupFieldId, groupingFields],
	);
	const serverGroupingField = activeGroupingField?.serverGroupBy
		? activeGroupingField
		: null;
	const objectAggregatesQuery = useQuery({
		queryKey: [
			"object-aggregates",
			parsedClassId,
			serverGroupingField?.serverGroupBy,
			groupSort,
			effectiveFetchLimit,
			aggregateCursor,
			serverFilterSignature,
		],
		queryFn: () =>
			fetchObjectAggregates({
				classId: parsedClassId ?? 0,
				groupBy: [serverGroupingField?.serverGroupBy ?? "name"],
				sort: toObjectAggregateSort(groupSort),
				limit: effectiveFetchLimit,
				cursor: aggregateCursor ?? undefined,
				filters: serverFilters,
			}),
		enabled: parsedClassId !== null && serverGroupingField !== null,
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset aggregate pagination whenever its request scope changes.
	useEffect(() => {
		setAggregateCursor(null);
		setAggregateCursorHistory([]);
	}, [
		effectiveFetchLimit,
		groupSort,
		selectedClassId,
		serverFilterSignature,
		serverGroupingField?.serverGroupBy,
	]);
	const serverAggregateGroups = useMemo<DisplayedAggregateGroup[]>(
		() =>
			(objectAggregatesQuery.data?.rows ?? []).map((row) => {
				const dimension = row.dimensions[0];
				let label = dimension
					? formatObjectAggregateDimension(dimension)
					: "(missing)";
				if (
					dimension?.field === "collection_id" &&
					dimension.state === "value" &&
					typeof dimension.value === "number"
				) {
					const collectionName = collectionNameById.get(dimension.value);
					label = collectionName
						? `${collectionName} (#${dimension.value})`
						: `#${dimension.value}`;
				}
				return {
					id: JSON.stringify(row.dimensions),
					label,
					count: row.object_count,
				};
			}),
		[collectionNameById, objectAggregatesQuery.data?.rows],
	);
	const groupedObjects = useMemo(
		() =>
			activeGroupingField && !serverGroupingField
				? groupObjectRows(
						filteredObjects,
						activeGroupingField.getValue,
						groupSort,
					)
				: [],
		[activeGroupingField, filteredObjects, groupSort, serverGroupingField],
	);
	const displayedGroups: readonly DisplayedAggregateGroup[] =
		serverGroupingField ? serverAggregateGroups : groupedObjects;
	const displayedObjects = useMemo(() => {
		if (!dataColumnSort.columnId) {
			return filteredObjects;
		}

		const sortedColumn = activeDataColumns.find(
			(column) => column.id === dataColumnSort.columnId,
		);
		if (!sortedColumn) {
			return filteredObjects;
		}

		return [...filteredObjects].sort((left, right) => {
			const result = compareDataColumnValues(
				getValueAtFirstAvailableDataPath(left.data, sortedColumn.paths),
				getValueAtFirstAvailableDataPath(right.data, sortedColumn.paths),
				dataColumnSort.direction,
			);
			if (result !== 0) {
				return result;
			}
			return left.id - right.id;
		});
	}, [activeDataColumns, dataColumnSort, filteredObjects]);
	const groupedExportView = useMemo<TableExportView<DisplayedAggregateGroup>>(
		() => ({
			id:
				parsedClassId === null
					? "objects.grouped"
					: `objects.class.${parsedClassId}.grouped`,
			fileName: `${selectedClass?.name ?? "objects"}-grouped-view`,
			sheetName: `${selectedClass?.name ?? "Objects"} groups`,
			columns: [
				{
					key: "group",
					label: activeGroupingField?.label ?? "Group",
					getValue: (group) => group.label,
				},
				{
					key: "count",
					label: "Count",
					getValue: (group) => group.count,
				},
			],
			rows: displayedGroups,
		}),
		[
			activeGroupingField?.label,
			displayedGroups,
			parsedClassId,
			selectedClass?.name,
		],
	);
	const objectExportColumns = useMemo<
		TableExportColumn<HubuumObjectComputedResponse>[]
	>(() => {
		const columns: TableExportColumn<HubuumObjectComputedResponse>[] = [
			{ key: "id", label: "ID", getValue: (item) => item.id },
			{ key: "name", label: "Name", getValue: (item) => item.name },
			{
				key: "collection",
				label: "Collection",
				getValue: (item) => {
					const collectionName = collectionNameById.get(item.collection_id);
					return collectionName
						? `${collectionName} (#${item.collection_id})`
						: item.collection_id;
				},
			},
			{
				key: "description",
				label: "Description",
				getValue: (item) => item.description,
			},
		];
		for (const column of activeDataColumns) {
			const heading = dataColumnHeadings.get(column.id) ?? {
				context: "",
				label: column.label,
			};
			columns.push({
				key: `data.${column.id}`,
				label: heading.context
					? `${heading.context} · ${heading.label}`
					: heading.label,
				getValue: (item) =>
					getValueAtFirstAvailableDataPath(item.data, column.paths),
			});
		}
		for (const column of activeComputedColumns) {
			columns.push({
				key: `computed.${column.id}`,
				label: `${column.scope === "shared" ? "S" : "P"}: ${column.label}`,
				getValue: (item) => getComputedColumnResult(item, column).value,
			});
		}
		if (showRawDataColumn) {
			columns.push({
				key: "data",
				label: "Data",
				getValue: (item) => item.data,
			});
		}
		return columns;
	}, [
		activeComputedColumns,
		activeDataColumns,
		collectionNameById,
		dataColumnHeadings,
		showRawDataColumn,
	]);
	const objectExportView = useMemo<
		TableExportView<HubuumObjectComputedResponse>
	>(
		() => ({
			id: parsedClassId === null ? "objects" : `objects.class.${parsedClassId}`,
			fileName: `${selectedClass?.name ?? "objects"}-view`,
			sheetName: selectedClass?.name ?? "Objects",
			columns: objectExportColumns,
			rows: displayedObjects,
		}),
		[displayedObjects, objectExportColumns, parsedClassId, selectedClass?.name],
	);
	useResizableTable({
		tableId: "objects-table",
		storageKey: "objects",
		columnSignature: [
			objectsQuery.data ? "ready" : "pending",
			filteredObjects.length > 0 ? "visible" : "hidden",
			activeGroupingField ? `group:${activeGroupingField.id}` : "ungrouped",
			...activeDataColumns.map((column) => column.id),
			...activeComputedColumns.map((column) => column.id),
			showRawDataColumn ? "raw" : "no-raw",
		].join("|"),
	});
	const allSelected =
		!activeGroupingField &&
		displayedObjects.length > 0 &&
		selectedObjectIds.length === displayedObjects.length;
	const activeStandardDataColumnCount = activeDataColumns.filter(
		(column) => column.source === "data",
	).length;
	const activeCustomDataColumnCount = activeDataColumns.filter(
		(column) => column.source === "custom",
	).length;

	useEffect(() => {
		if (!activeGroupingField) return;
		setSelectedObjectIds((current) => (current.length ? [] : current));
	}, [activeGroupingField]);

	useEffect(() => {
		setLoadedHiddenComputedColumnsStorageKey(null);
		if (!hiddenComputedColumnsStorageKey) {
			setHiddenComputedColumnIds((current) => (current.length ? [] : current));
			return;
		}
		if (sharedComputedQuery.isLoading || personalComputedQuery.isLoading) {
			return;
		}

		const availableIds = new Set(computedColumns.map((column) => column.id));
		try {
			const storedValue = window.localStorage.getItem(
				hiddenComputedColumnsStorageKey,
			);
			if (storedValue !== null) {
				const parsedValue = JSON.parse(storedValue);
				if (Array.isArray(parsedValue)) {
					const nextHiddenIds = parsedValue
						.filter((value): value is string => typeof value === "string")
						.filter((value, index, values) => values.indexOf(value) === index)
						.filter((value) => availableIds.has(value));
					setHiddenComputedColumnIds((current) =>
						areStringArraysEqual(current, nextHiddenIds)
							? current
							: nextHiddenIds,
					);
					setLoadedHiddenComputedColumnsStorageKey(
						hiddenComputedColumnsStorageKey,
					);
					return;
				}
			}
		} catch {
			// Ignore unavailable or malformed localStorage.
		}

		setHiddenComputedColumnIds((current) => (current.length ? [] : current));
		setLoadedHiddenComputedColumnsStorageKey(hiddenComputedColumnsStorageKey);
	}, [
		computedColumns,
		hiddenComputedColumnsStorageKey,
		personalComputedQuery.isLoading,
		sharedComputedQuery.isLoading,
	]);

	useEffect(() => {
		if (
			!hiddenComputedColumnsStorageKey ||
			loadedHiddenComputedColumnsStorageKey !==
				hiddenComputedColumnsStorageKey ||
			!isUserSettingsSyncInitialized()
		) {
			return;
		}

		try {
			writeUserSetting(
				hiddenComputedColumnsStorageKey,
				JSON.stringify(hiddenComputedColumnIds),
			);
		} catch {
			// Ignore unavailable localStorage.
		}
	}, [
		hiddenComputedColumnIds,
		hiddenComputedColumnsStorageKey,
		loadedHiddenComputedColumnsStorageKey,
	]);

	useEffect(() => {
		setLoadedCustomDataFieldsStorageKey(null);
		if (!customDataFieldsStorageKey) {
			setCustomDataFields((current) => (current.length ? [] : current));
			setLoadedCustomDataFieldsStorageKey(null);
			return;
		}

		try {
			const storedValue = window.localStorage.getItem(
				customDataFieldsStorageKey,
			);
			if (storedValue) {
				const parsedValue = JSON.parse(storedValue);
				if (Array.isArray(parsedValue)) {
					const nextFields = parsedValue
						.map(normalizeCustomDataField)
						.filter((field): field is CustomDataField => field !== null);
					setCustomDataFields((current) =>
						JSON.stringify(current) === JSON.stringify(nextFields)
							? current
							: nextFields,
					);
					setLoadedCustomDataFieldsStorageKey(customDataFieldsStorageKey);
					return;
				}
			}
		} catch {
			// Ignore unavailable or malformed localStorage.
		}

		setCustomDataFields((current) => (current.length ? [] : current));
		setLoadedCustomDataFieldsStorageKey(customDataFieldsStorageKey);
	}, [customDataFieldsStorageKey]);

	useEffect(() => {
		if (
			!customDataFieldsStorageKey ||
			!customDataFieldsReady ||
			!isUserSettingsSyncInitialized()
		) {
			return;
		}

		try {
			writeUserSetting(
				customDataFieldsStorageKey,
				JSON.stringify(customDataFields),
			);
		} catch {
			// Ignore unavailable localStorage.
		}
	}, [customDataFields, customDataFieldsStorageKey, customDataFieldsReady]);

	useEffect(() => {
		if (!customDataFieldsReady) {
			return;
		}
		if (!dataColumnStorageKey) {
			setSelectedDataColumns((current) => (current.length ? [] : current));
			return;
		}
		if (dataColumnCandidates.length === 0 && customDataFields.length === 0) {
			setSelectedDataColumns((current) => (current.length ? [] : current));
			return;
		}

		try {
			const storedValue = window.localStorage.getItem(dataColumnStorageKey);
			if (storedValue) {
				const parsedValue = JSON.parse(storedValue);
				if (Array.isArray(parsedValue)) {
					if (parsedValue.length === 0) {
						setSelectedDataColumns((current) =>
							current.length ? [] : current,
						);
						return;
					}

					const candidateIds = new Set([
						...dataColumnCandidates.map((column) => column.id),
						...customDataFields.map((field) => field.id),
					]);
					const nextColumns = parsedValue
						.filter((value): value is string => typeof value === "string")
						.map((value) => {
							if (value.startsWith(CUSTOM_DATA_FIELD_ID_PREFIX)) {
								return value;
							}
							const path = parseDataPathId(value);
							return path ? getDataPathId(path) : null;
						})
						.filter((id): id is string => id !== null)
						.filter((id) => candidateIds.has(id))
						.slice(0, MAX_SELECTED_DATA_COLUMNS);
					if (nextColumns.length > 0) {
						setSelectedDataColumns((current) =>
							areStringArraysEqual(current, nextColumns)
								? current
								: nextColumns,
						);
						return;
					}
				}
			}
		} catch {
			// Ignore unavailable or malformed localStorage.
		}

		const nextColumns = dataColumnCandidates
			.slice(0, DEFAULT_SELECTED_DATA_COLUMN_COUNT)
			.map((column) => column.id);
		setSelectedDataColumns((current) =>
			areStringArraysEqual(current, nextColumns) ? current : nextColumns,
		);
	}, [
		customDataFields,
		customDataFieldsReady,
		dataColumnCandidates,
		dataColumnStorageKey,
	]);

	useEffect(() => {
		if (
			!dataColumnStorageKey ||
			!customDataFieldsReady ||
			!isUserSettingsSyncInitialized()
		) {
			return;
		}
		if (dataColumnCandidates.length === 0 && customDataFields.length === 0) {
			return;
		}

		try {
			writeUserSetting(
				dataColumnStorageKey,
				JSON.stringify(activeDataColumns.map((column) => column.id)),
			);
		} catch {
			// Ignore unavailable localStorage.
		}
	}, [
		activeDataColumns,
		customDataFields.length,
		customDataFieldsReady,
		dataColumnCandidates.length,
		dataColumnStorageKey,
	]);

	useEffect(() => {
		if (!rawDataColumnStorageKey || !isUserSettingsSyncInitialized()) {
			setShowRawDataColumn((current) => (current ? current : true));
			return;
		}

		try {
			const storedValue = window.localStorage.getItem(rawDataColumnStorageKey);
			if (storedValue === "hidden") {
				setShowRawDataColumn(false);
				return;
			}
			if (storedValue === "visible") {
				setShowRawDataColumn(true);
				return;
			}
		} catch {
			// Ignore unavailable localStorage.
		}

		setShowRawDataColumn((current) => (current ? current : true));
	}, [rawDataColumnStorageKey]);

	useEffect(() => {
		if (!rawDataColumnStorageKey) {
			return;
		}

		try {
			writeUserSetting(
				rawDataColumnStorageKey,
				showRawDataColumn ? "visible" : "hidden",
			);
		} catch {
			// Ignore unavailable localStorage.
		}
	}, [rawDataColumnStorageKey, showRawDataColumn]);

	useEffect(() => {
		if (!dataColumnSort.columnId) {
			return;
		}
		if (
			activeDataColumns.some((column) => column.id === dataColumnSort.columnId)
		) {
			return;
		}
		setDataColumnSort({ columnId: null, direction: "asc" });
	}, [activeDataColumns, dataColumnSort.columnId]);

	useEffect(() => {
		if (!isColumnPickerOpen) {
			return;
		}

		function onPointerDown(event: MouseEvent) {
			if (!columnPickerRef.current?.contains(event.target as Node)) {
				setColumnPickerOpen(false);
			}
		}

		document.addEventListener("mousedown", onPointerDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
		};
	}, [isColumnPickerOpen]);
	useEscapeToCancel({
		enabled: isColumnPickerOpen,
		onCancel: () => {
			setColumnPickerOpen(false);
			window.setTimeout(
				() =>
					columnPickerRef.current
						?.querySelector<HTMLButtonElement>(".object-column-picker-trigger")
						?.focus(),
				0,
			);
		},
	});

	const shiftSelect = useShiftSelect({
		items: displayedObjects,
		selectedIds: selectedObjectIds,
		setSelectedIds: setSelectedObjectIds,
		getId: (objectItem) => objectItem.id,
	});
	const keyboardNav = useTableKeyboardNav({
		items: displayedObjects,
		getId: (objectItem) => objectItem.id,
		onOpen: (objectItem) =>
			router.push(`/objects/${objectItem.hubuum_class_id}/${objectItem.id}`),
	});

	useEffect(() => {
		if (!selectedObjectIds.length) {
			return;
		}

		const existingIds = new Set(
			displayedObjects.map((objectItem) => objectItem.id),
		);
		setSelectedObjectIds((current) => {
			const next = current.filter((objectId) => existingIds.has(objectId));
			return next.length === current.length ? current : next;
		});
	}, [displayedObjects, selectedObjectIds]);

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
			setSelectedObjectIds(displayedObjects.map((obj) => obj.id));
		};

		window.addEventListener(DESELECT_ALL_EVENT, onDeselectAll);
		window.addEventListener(SELECT_ALL_EVENT, onSelectAll);
		return () => {
			window.removeEventListener(DESELECT_ALL_EVENT, onDeselectAll);
			window.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
		};
	}, [displayedObjects]);

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
		if (dataColumnSort.columnId) {
			return (
				<span className="sort-indicator" aria-hidden="true">
					⇅
				</span>
			);
		}
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

	function renderDataSortIndicator(columnId: string) {
		if (dataColumnSort.columnId !== columnId) {
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
				{dataColumnSort.direction === "asc" ? "↑" : "↓"}
			</span>
		);
	}

	function getServerSortAria(
		column: string,
	): "ascending" | "descending" | "none" {
		if (dataColumnSort.columnId || sortState.column !== column) return "none";
		return sortState.direction === "asc" ? "ascending" : "descending";
	}

	function onServerSortKeyDown(
		event: ReactKeyboardEvent<HTMLTableCellElement>,
		column: string,
	) {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		setServerSort(column);
	}

	function setServerSort(column: string) {
		setDataColumnSort({ columnId: null, direction: "asc" });
		setSort(column);
	}

	function setDataSort(columnId: string) {
		if (sortState.column) {
			clearSort();
		}
		setDataColumnSort((current) => {
			if (current.columnId !== columnId) {
				return { columnId, direction: "asc" };
			}
			if (current.direction === "asc") {
				return { columnId, direction: "desc" };
			}
			return { columnId: null, direction: "asc" };
		});
	}

	function setGroupedColumnSort(column: "value" | "count") {
		setGroupSort((current) => {
			if (column === "value") {
				return current === "value-asc" ? "value-desc" : "value-asc";
			}
			return current === "count-desc" ? "count-asc" : "count-desc";
		});
		setAggregateCursor(null);
		setAggregateCursorHistory([]);
	}

	function goToNextAggregatePage(nextCursor: string) {
		setAggregateCursorHistory((current) => [
			...current,
			aggregateCursor ?? FIRST_AGGREGATE_PAGE,
		]);
		setAggregateCursor(nextCursor);
	}

	function goToPreviousAggregatePage(prevCursor?: string) {
		const previousEntry = aggregateCursorHistory.at(-1);
		const targetCursor =
			previousEntry === FIRST_AGGREGATE_PAGE
				? null
				: (previousEntry ?? prevCursor ?? null);
		setAggregateCursorHistory((current) => current.slice(0, -1));
		setAggregateCursor(targetCursor);
	}

	function goToFirstAggregatePage() {
		setAggregateCursorHistory([]);
		setAggregateCursor(null);
	}

	function renderGroupedSortIndicator(column: "value" | "count") {
		const isActive = groupSort.startsWith(column);
		return (
			<span
				className={`sort-indicator${isActive ? " sort-indicator--active" : ""}`}
				aria-hidden="true"
			>
				{isActive ? (groupSort.endsWith("asc") ? "↑" : "↓") : "⇅"}
			</span>
		);
	}

	function getGroupedSortAria(
		column: "value" | "count",
	): "ascending" | "descending" | "none" {
		if (!groupSort.startsWith(column)) return "none";
		return groupSort.endsWith("asc") ? "ascending" : "descending";
	}

	function setGroupingField(nextFieldId: string | null) {
		const nextGroupingField =
			groupingFields.find((field) => field.id === nextFieldId) ?? null;
		setGroupFieldId(nextFieldId);
		setAggregateCursor(null);
		setAggregateCursorHistory([]);
		if (
			nextGroupingField?.serverGroupBy &&
			(searchTerm || normalizeSearchTerm(searchInput))
		) {
			clearFilter();
		}
		if (nextFieldId) {
			setDataColumnSort({ columnId: null, direction: "asc" });
			setSelectedObjectIds([]);
		}
	}

	function toggleDataColumnPicker() {
		setColumnPickerOpen((current) => !current);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!createSelectedClass || parsedCreateClassId === null) {
			showToast("Select a class before creating an object.", "error");
			return;
		}

		const parsedCollectionId = Number.parseInt(collectionId, 10);
		if (!Number.isFinite(parsedCollectionId) || parsedCollectionId < 1) {
			showToast("Collection is required.", "error");
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
			collection_id: parsedCollectionId,
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

		const submitButton = event.currentTarget.querySelector<HTMLButtonElement>(
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

	function updateServerFilters(nextFilters: ObjectServerFilter[]) {
		setAggregateCursor(null);
		setAggregateCursorHistory([]);
		const params = new URLSearchParams(searchParams.toString());
		if (nextFilters.length > 0) {
			params.set(
				OBJECT_SERVER_FILTERS_QUERY_KEY,
				serializeObjectServerFilters(nextFilters),
			);
		} else {
			params.delete(OBJECT_SERVER_FILTERS_QUERY_KEY);
		}
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

	function toggleComputedColumn(columnId: string, checked: boolean) {
		setHiddenComputedColumnIds((current) => {
			if (checked) {
				return current.filter((currentId) => currentId !== columnId);
			}
			return current.includes(columnId) ? current : [...current, columnId];
		});
	}

	function addCustomDataField(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!customDataFieldsStorageKey) {
			showToast("Select a class before adding custom data fields.", "error");
			return;
		}

		const label = customDataFieldLabel.trim();
		const expression = customDataFieldExpression.trim();
		const paths = parseCustomDataFieldExpression(expression);
		if (!label) {
			showToast("Custom data field label is required.", "error");
			return;
		}
		if (paths.length === 0) {
			showToast("Enter at least one valid data path.", "error");
			return;
		}
		if (
			customDataFields.some(
				(field) => field.label.toLowerCase() === label.toLowerCase(),
			)
		) {
			showToast("A custom data field with that label already exists.", "error");
			return;
		}

		const id = `${CUSTOM_DATA_FIELD_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const nextField: CustomDataField = {
			id,
			label,
			expression,
			paths,
			scope: "user",
		};
		const nextFields = [...customDataFields, nextField];
		if (!persistCustomDataFields(customDataFieldsStorageKey, nextFields)) {
			showToast("Could not save custom data fields in this browser.", "error");
			return;
		}

		setCustomDataFields(nextFields);
		setSelectedDataColumns((current) =>
			current.includes(id) || current.length >= MAX_SELECTED_DATA_COLUMNS
				? current
				: [...current, id],
		);
		setCustomDataFieldLabel("");
		setCustomDataFieldExpression("");
		showToast("Custom data field added.", "success");
	}

	function deleteCustomDataField(fieldId: string) {
		const nextFields = customDataFields.filter(
			(candidate) => candidate.id !== fieldId,
		);
		if (!persistCustomDataFields(customDataFieldsStorageKey, nextFields)) {
			showToast("Could not save custom data fields.", "error");
			return;
		}

		setCustomDataFields(nextFields);
		setSelectedDataColumns((current) =>
			current.filter((columnId) => columnId !== fieldId),
		);
	}

	function resetDataColumns() {
		setSelectedDataColumns(
			dataColumnCandidates
				.slice(0, DEFAULT_SELECTED_DATA_COLUMN_COUNT)
				.map((column) => column.id),
		);
		setHiddenComputedColumnIds([]);
	}

	function clearDataColumns() {
		setSelectedDataColumns([]);
		setHiddenComputedColumnIds(computedColumns.map((column) => column.id));
	}

	function renderCollection(value: number): string {
		const collectionName = collectionNameById.get(value);
		return collectionName ? `${collectionName} (#${value})` : `#${value}`;
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
						<span>Collection</span>
						{collections.length > 0 ? (
							<select
								required
								value={collectionId}
								onChange={(event) => setCollectionId(event.target.value)}
								disabled={!createSelectedClass}
							>
								{collections.map((collection) => (
									<option key={collection.id} value={collection.id}>
										{collection.name} (#{collection.id})
									</option>
								))}
							</select>
						) : (
							<input
								required
								type="number"
								min={1}
								value={collectionId}
								onChange={(event) => setCollectionId(event.target.value)}
								placeholder={
									collectionsQuery.isLoading
										? "Loading collections..."
										: "Enter collection id"
								}
								disabled={!createSelectedClass || collectionsQuery.isLoading}
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

				{collectionsQuery.isError ? (
					<div className="muted">
						Could not load collections automatically. Falling back to manual
						collection ID entry.
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

			<div className="card table-wrap resource-index objects-resource-index">
				<div className="table-header">
					<div className="resource-index-title">
						<div className="table-title-row">
							<h2>Objects</h2>
							<span className="muted table-count">
								{serverGroupingField
									? objectAggregatesQuery.data
										? `${serverAggregateGroups.length} group${serverAggregateGroups.length === 1 ? "" : "s"} loaded${typeof objectAggregatesQuery.data.totalCount === "number" && objectAggregatesQuery.data.totalCount !== serverAggregateGroups.length ? ` · ${objectAggregatesQuery.data.totalCount} total` : ""}`
										: "Waiting..."
									: objectsQuery.data
										? searchTerm
											? `${filteredObjects.length} shown on page · ${objects.length} loaded`
											: typeof pageData?.totalCount === "number" &&
													pageData?.totalCount !== objects.length
												? `${objects.length} loaded · ${pageData?.totalCount} ${serverFilters.length ? "matches" : "total"}`
												: `${objects.length} loaded`
										: parsedClassId
											? "Waiting..."
											: "No class"}
								{selectedObjectIds.length
									? ` · ${selectedObjectIds.length} selected`
									: ""}
								{activeGroupingField && !serverGroupingField
									? ` · ${displayedGroups.length} group${displayedGroups.length === 1 ? "" : "s"}`
									: ""}
							</span>
						</div>
					</div>
					<div className="table-tools">
						<fieldset
							className="object-fetch-limit"
							disabled={parsedClassId === null}
						>
							<legend className="sr-only">Fetch</legend>
							<div className="segmented-control">
								{OBJECT_FETCH_LIMIT_OPTIONS.map((option) => (
									<button
										key={option.value}
										type="button"
										className={
											pagination.limit === option.value ? "is-active" : ""
										}
										aria-pressed={pagination.limit === option.value}
										onClick={() => pagination.setLimit(option.value)}
										title={`${option.label} objects per server request`}
									>
										{option.label}
									</button>
								))}
							</div>
						</fieldset>
						<div className="object-column-picker" ref={columnPickerRef}>
							<button
								type="button"
								className="ghost object-column-picker-trigger"
								onClick={toggleDataColumnPicker}
								disabled={parsedClassId === null}
								aria-haspopup="dialog"
								aria-expanded={isColumnPickerOpen}
								aria-controls="object-columns-popover"
							>
								<IconColumns />
								<span>Columns</span>
								{activeStandardDataColumnCount +
								activeCustomDataColumnCount +
								activeComputedColumns.length ? (
									<span className="object-column-count">
										{activeStandardDataColumnCount +
											activeCustomDataColumnCount +
											activeComputedColumns.length}
									</span>
								) : null}
							</button>
							{isColumnPickerOpen ? (
								<div
									id="object-columns-popover"
									className="object-column-menu card"
									role="dialog"
									aria-label="Object columns"
									style={
										{
											"--object-column-menu-width": columnMenuWidth,
										} as React.CSSProperties
									}
								>
									<div className="object-column-menu-header">
										<div>
											<strong>Visible columns</strong>
											<p className="muted">
												Choose up to {MAX_SELECTED_DATA_COLUMNS} data fields.
											</p>
										</div>
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
									<label className="object-column-option object-column-option--raw">
										<input
											type="checkbox"
											checked={showRawDataColumn}
											onChange={(event) =>
												setShowRawDataColumn(event.target.checked)
											}
										/>
										<span>
											<strong>Raw data preview</strong>
											<small>{showRawDataColumn ? "shown" : "hidden"}</small>
										</span>
									</label>
									{computedColumns.length > 0 ? (
										<>
											<div className="object-column-section-heading">
												<strong>Computed fields</strong>
												<Link
													className="muted"
													href={`/classes/${parsedClassId}#computed-fields`}
												>
													Manage
												</Link>
											</div>
											<div className="object-column-options">
												{computedColumns.map((column) => {
													const checked = !hiddenComputedColumnIds.includes(
														column.id,
													);
													return (
														<label
															className="object-column-option"
															key={column.id}
														>
															<input
																type="checkbox"
																checked={checked}
																onChange={(event) =>
																	toggleComputedColumn(
																		column.id,
																		event.target.checked,
																	)
																}
																aria-label={`Show ${column.scope} computed field ${column.label}`}
															/>
															<span>
																<strong>{column.label}</strong>
																<small>
																	{column.scope} ·{" "}
																	{checked ? "shown" : "hidden"}
																</small>
															</span>
														</label>
													);
												})}
											</div>
										</>
									) : null}
									<div className="object-column-section-heading">
										<strong>Data fields</strong>
										<span className="muted">Class data</span>
									</div>
									{dataColumnCandidates.length === 0 ? (
										<p className="muted">No data fields loaded.</p>
									) : (
										<div className="object-column-options">
											{sortedDataColumnCandidates.map((column) => {
												const checked = selectedDataColumns.includes(column.id);
												const disabled =
													!checked &&
													activeDataColumns.length >= MAX_SELECTED_DATA_COLUMNS;
												return (
													<label
														key={column.id}
														className="object-column-option"
													>
														<input
															type="checkbox"
															checked={checked}
															disabled={disabled}
															onChange={(event) =>
																toggleDataColumn(
																	column.id,
																	event.target.checked,
																)
															}
														/>
														<span>
															<strong title={column.label}>
																{column.label}
															</strong>
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
									<div className="object-column-section-heading">
										<strong>Custom fields</strong>
										<span className="muted">Only visible to you</span>
									</div>
									{customDataFields.length === 0 ? (
										<p className="muted">No custom data fields yet.</p>
									) : (
										<div className="object-column-options">
											{customDataFields.map((field) => {
												const checked = selectedDataColumns.includes(field.id);
												const disabled =
													!checked &&
													activeDataColumns.length >= MAX_SELECTED_DATA_COLUMNS;
												return (
													<div
														key={field.id}
														className="object-column-option object-column-option--custom"
													>
														<input
															type="checkbox"
															checked={checked}
															disabled={disabled}
															onChange={(event) =>
																toggleDataColumn(field.id, event.target.checked)
															}
															aria-label={`Show ${field.label}`}
														/>
														<span>
															<strong title={field.label}>{field.label}</strong>
															<small title={field.expression}>Only me</small>
														</span>
														<button
															type="button"
															className="ghost object-column-delete"
															onClick={() => deleteCustomDataField(field.id)}
															aria-label={`Delete ${field.label}`}
														>
															Delete
														</button>
													</div>
												);
											})}
										</div>
									)}
									<details className="custom-data-field-disclosure">
										<summary>Create a custom field</summary>
										<form
											className="custom-data-field-form"
											onSubmit={addCustomDataField}
										>
											<div className="custom-data-field-scope">
												<span className="muted">
													Saved to your account as a display preference.
												</span>
											</div>
											<label className="control-field">
												<span>Label</span>
												<input
													value={customDataFieldLabel}
													onChange={(event) =>
														setCustomDataFieldLabel(event.target.value)
													}
													placeholder="OS version"
												/>
											</label>
											<label className="control-field">
												<span>Paths</span>
												<input
													value={customDataFieldExpression}
													onChange={(event) =>
														setCustomDataFieldExpression(event.target.value)
													}
													placeholder="os.fedora.version|os.redhat.version|os.macos.version"
												/>
											</label>
											<p className="muted">
												Uses the first non-empty path. Escape literal dots or
												pipes with a backslash.
											</p>
											<button type="submit">Add custom field</button>
										</form>
									</details>
								</div>
							) : null}
						</div>
						<ObjectGroupingMenu
							fields={groupingFields}
							fieldId={groupFieldId}
							sort={groupSort}
							onFieldChange={setGroupingField}
							onSortChange={setGroupSort}
							disabled={parsedClassId === null || objectsQuery.isFetching}
						/>
						<ObjectServerFilterMenu
							filters={serverFilters}
							dataFields={serverFilterDataFields}
							computedFields={serverFilterComputedFields}
							onChange={updateServerFilters}
							disabled={parsedClassId === null}
						/>
						{activeGroupingField ? (
							<TableExportMenu
								view={groupedExportView}
								disabled={objectsQuery.isFetching}
							/>
						) : (
							<TableExportMenu
								view={objectExportView}
								disabled={objectsQuery.isFetching}
							/>
						)}
						<form className="table-filter-form" onSubmit={onFilterSubmit}>
							<div className="table-filter-field">
								<input
									aria-label="Find objects on this loaded page"
									className="table-filter-input"
									value={searchInput}
									onChange={(event) => setSearchInput(event.target.value)}
									placeholder={
										serverGroupingField
											? "Unavailable while grouping"
											: "Find on this page"
									}
									disabled={serverGroupingField !== null}
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
								aria-label="Find objects on this page"
								disabled={serverGroupingField !== null}
							>
								<IconSearch />
							</button>
						</form>
					</div>
				</div>
				{sharedComputedQuery.isError || personalComputedQuery.isError ? (
					<div className="muted" role="status">
						Some computed field definitions could not be loaded. Object data is
						still available.
					</div>
				) : null}
				{activeComputedColumns.some((column) => column.scope === "shared") &&
				objects.some(
					(objectItem) => objectItem.computed.shared.materialization_stale,
				) ? (
					<div className="table-scope-note" role="status">
						<span>
							<strong>Shared computed values are rebuilding.</strong> Displayed
							values may be stale until materialization finishes.
						</span>
					</div>
				) : null}
				{searchTerm ||
				serverFilters.length > 0 ||
				dataColumnSort.columnId ||
				activeGroupingField ? (
					<div className="table-scope-note" role="status">
						{serverFilters.length > 0 ? (
							<span>
								<strong>
									{serverFilters.length} server filter
									{serverFilters.length === 1 ? "" : "s"}
								</strong>{" "}
								querying every object in this class.
							</span>
						) : null}
						{searchTerm ? (
							<span>
								<strong>Find on page</strong> is narrowing the {objects.length}{" "}
								loaded row{objects.length === 1 ? "" : "s"}.
							</span>
						) : null}
						{dataColumnSort.columnId ? (
							<span>
								<strong>Loaded-page sort</strong> is active for a data field;
								standard columns sort the full server result.
							</span>
						) : null}
						{activeGroupingField ? (
							<span>
								<strong>Grouped by {activeGroupingField.label}</strong>{" "}
								{serverGroupingField
									? "across every object matching the server filters; counts are permission-aware and do not depend on the loaded object page."
									: `across the ${filteredObjects.length} loaded row${filteredObjects.length === 1 ? "" : "s"}; custom-field counts update when you change page.`}
							</span>
						) : null}
					</div>
				) : null}

				{parsedClassId === null ? (
					<div className="muted">Select a class to load its objects.</div>
				) : serverGroupingField && objectAggregatesQuery.isLoading ? (
					<div>Loading object aggregates...</div>
				) : serverGroupingField && objectAggregatesQuery.isError ? (
					<div className="error-banner">
						Failed to aggregate objects.{" "}
						{objectAggregatesQuery.error instanceof Error
							? objectAggregatesQuery.error.message
							: "Unknown error"}
					</div>
				) : !serverGroupingField && objectsQuery.isLoading ? (
					<div>Loading objects...</div>
				) : !serverGroupingField && objectsQuery.isError ? (
					<div className="error-banner">
						Failed to load objects.{" "}
						{objectsQuery.error instanceof Error
							? objectsQuery.error.message
							: "Unknown error"}
					</div>
				) : activeGroupingField && displayedGroups.length === 0 ? (
					<EmptyState
						title="No aggregate groups match this query."
						description={
							serverGroupingField
								? "Change or clear the server filters to broaden the aggregation."
								: "Change page or choose another grouping field."
						}
						action={
							serverFilters.length > 0 ? (
								<button type="button" onClick={() => updateServerFilters([])}>
									Clear server filters
								</button>
							) : undefined
						}
					/>
				) : !activeGroupingField && filteredObjects.length === 0 ? (
					<EmptyState
						title={
							searchTerm
								? `No loaded objects match "${searchTerm}".`
								: serverFilters.length > 0
									? "No objects match the server filters."
									: "No objects available in the selected class."
						}
						description={
							searchTerm
								? "Clear Find on page to return to the current server result."
								: serverFilters.length > 0
									? "Change or clear the server filters to broaden the class query."
									: "Create an object to start populating this class."
						}
						action={
							searchTerm ? (
								<button type="button" onClick={clearFilter}>
									Clear Find on page
								</button>
							) : serverFilters.length > 0 ? (
								<button type="button" onClick={() => updateServerFilters([])}>
									Clear server filters
								</button>
							) : (
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
				) : activeGroupingField ? (
					<section
						className="object-table-scroll object-grouped-table-scroll"
						aria-label={
							serverGroupingField ? "Object aggregates" : "Grouped objects"
						}
					>
						<table className="object-grouped-table">
							<caption className="sr-only">
								Objects grouped by {activeGroupingField.label}
							</caption>
							<thead>
								<tr>
									<th aria-sort={getGroupedSortAria("value")}>
										<button
											type="button"
											className="table-sort-button"
											onClick={() => setGroupedColumnSort("value")}
										>
											{activeGroupingField.label}
											{renderGroupedSortIndicator("value")}
										</button>
									</th>
									<th aria-sort={getGroupedSortAria("count")}>
										<button
											type="button"
											className="table-sort-button"
											onClick={() => setGroupedColumnSort("count")}
										>
											Count{renderGroupedSortIndicator("count")}
										</button>
									</th>
									{serverGroupingField ? null : <th>Examples</th>}
								</tr>
							</thead>
							<tbody>
								{displayedGroups.map((group) => (
									<tr key={group.id}>
										<td title={group.label}>{group.label}</td>
										<td className="object-group-count">{group.count}</td>
										{serverGroupingField ? null : (
											<td>
												<div className="object-group-examples">
													{(group.rows ?? []).slice(0, 3).map((objectItem) => (
														<Link
															key={objectItem.id}
															href={`/objects/${objectItem.hubuum_class_id}/${objectItem.id}`}
														>
															{objectItem.name}
														</Link>
													))}
													{(group.rows?.length ?? 0) > 3 ? (
														<span>+{(group.rows?.length ?? 0) - 3} more</span>
													) : null}
												</div>
											</td>
										)}
									</tr>
								))}
							</tbody>
						</table>
					</section>
				) : (
					<>
						<p className="table-scroll-hint">
							Swipe horizontally to see more columns. Names remain pinned.
						</p>
						<section className="object-table-scroll" aria-label="Objects table">
							<table id="objects-table">
								<caption className="sr-only">Objects</caption>
								<colgroup>
									<col
										className="object-select-column"
										data-column-key="select"
									/>
									<col className="object-id-column" data-column-key="id" />
									<col className="object-name-column" data-column-key="name" />
									<col
										className="object-collection-column"
										data-column-key="collection"
									/>
									<col
										className="object-description-column"
										data-column-key="description"
									/>
									{activeDataColumns.map((column) => (
										<col
											key={column.id}
											className="object-promoted-data-column"
											data-column-key={`data:${column.id}`}
										/>
									))}
									{activeComputedColumns.map((column) => (
										<col
											key={column.id}
											className="object-promoted-data-column"
											data-column-key={`computed:${column.id}`}
										/>
									))}
									{showRawDataColumn ? (
										<col
											className="object-data-column"
											data-column-key="raw-data"
										/>
									) : null}
								</colgroup>
								<thead>
									<tr>
										<th className="check-col" data-column-key="select">
											<input
												type="checkbox"
												aria-label="Select all objects"
												checked={allSelected}
												onChange={(event) =>
													shiftSelect.handleSelectAll(event.target.checked)
												}
											/>
										</th>
										<th
											className="sortable"
											data-column-key="id"
											title="Sort all matching objects by ID"
											aria-sort={getServerSortAria("id")}
											tabIndex={0}
											onClick={() => setServerSort("id")}
											onKeyDown={(event) => onServerSortKeyDown(event, "id")}
										>
											ID{renderSortIndicator("id")}
										</th>
										<th
											className="sortable"
											data-column-key="name"
											title="Sort all matching objects by name"
											aria-sort={getServerSortAria("name")}
											tabIndex={0}
											onClick={() => setServerSort("name")}
											onKeyDown={(event) => onServerSortKeyDown(event, "name")}
										>
											Name{renderSortIndicator("name")}
										</th>
										<th
											className="sortable"
											data-column-key="collection"
											title="Sort all matching objects by collection"
											aria-sort={getServerSortAria("collection_id")}
											tabIndex={0}
											onClick={() => setServerSort("collection_id")}
											onKeyDown={(event) =>
												onServerSortKeyDown(event, "collection_id")
											}
										>
											Collection{renderSortIndicator("collection_id")}
										</th>
										<th
											className="sortable"
											data-column-key="description"
											title="Sort all matching objects by description"
											aria-sort={getServerSortAria("description")}
											tabIndex={0}
											onClick={() => setServerSort("description")}
											onKeyDown={(event) =>
												onServerSortKeyDown(event, "description")
											}
										>
											Description{renderSortIndicator("description")}
										</th>
										{activeDataColumns.map((column) => {
											const heading = dataColumnHeadings.get(column.id) ?? {
												context: "",
												label: column.label,
											};
											return (
												<th
													key={column.id}
													className="object-data-field-heading"
													data-column-key={`data:${column.id}`}
													title={`${column.label} — sorts loaded rows`}
													aria-sort={
														dataColumnSort.columnId === column.id
															? dataColumnSort.direction === "asc"
																? "ascending"
																: "descending"
															: "none"
													}
												>
													<button
														type="button"
														className="object-column-sort"
														onClick={() => setDataSort(column.id)}
														aria-label={`Sort loaded rows by ${column.label}`}
													>
														<span
															className="object-data-field-icon"
															aria-hidden="true"
														>
															<IconDataField />
														</span>
														{heading.context ? (
															<>
																<span className="object-column-heading-context">
																	{heading.context}
																</span>
																<span
																	className="object-column-heading-separator"
																	aria-hidden="true"
																>
																	·
																</span>
															</>
														) : null}
														<span className="object-column-heading-label">
															<span className="object-column-heading-name">
																{heading.label}
															</span>
															{renderDataSortIndicator(column.id)}
														</span>
													</button>
												</th>
											);
										})}
										{activeComputedColumns.map((column) => {
											const sortColumn = `computed.${column.scope}.${column.key}`;
											return (
												<th
													key={column.id}
													className="sortable object-data-field-heading object-computed-field-heading"
													data-column-key={`computed:${column.id}`}
													title={`Sort all matching objects by ${column.scope === "shared" ? "shared" : "personal"} computed field ${column.label}`}
													aria-sort={getServerSortAria(sortColumn)}
													tabIndex={0}
													onClick={() => setServerSort(sortColumn)}
													onKeyDown={(event) =>
														onServerSortKeyDown(event, sortColumn)
													}
												>
													<span
														className="object-data-field-icon"
														aria-hidden="true"
													>
														{column.scope === "shared" ? (
															<IconSharedComputedField />
														) : (
															<IconPersonalComputedField />
														)}
													</span>
													<span className="sr-only">
														{column.scope === "shared" ? "Shared" : "Personal"}{" "}
														computed field:{" "}
													</span>
													<span className="object-column-heading-name">
														{column.label}
														{renderSortIndicator(sortColumn)}
													</span>
												</th>
											);
										})}
										{showRawDataColumn ? (
											<th
												className="object-raw-data-heading"
												data-column-key="raw-data"
											>
												Data
											</th>
										) : null}
									</tr>
								</thead>
								<tbody>
									{displayedObjects.map((objectItem, index) => {
										const isSelected = selectedObjectIds.includes(
											objectItem.id,
										);
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
												<td className="check-col" data-column-key="select">
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
												<td data-column-key="id">{objectItem.id}</td>
												<td data-column-key="name">
													<div className="object-name-cell">
														<Link
															href={`/objects/${objectItem.hubuum_class_id}/${objectItem.id}`}
															className="row-link"
															title={objectItem.name}
														>
															{objectItem.name}
														</Link>
														<Link
															href={`/relations/objects?classId=${objectItem.hubuum_class_id}&objectId=${objectItem.id}&objectView=reachable`}
															className="object-row-connections-link"
															aria-label={`Open connections for ${objectItem.name}`}
															title="Open connections"
														>
															<IconConnections />
														</Link>
													</div>
												</td>
												<td data-column-key="collection">
													{renderCollection(objectItem.collection_id)}
												</td>
												<td
													className="object-description-cell"
													data-column-key="description"
													title={objectItem.description || undefined}
												>
													{objectItem.description || "-"}
												</td>
												{activeDataColumns.map((column) => (
													<td
														key={column.id}
														className="object-data-field-cell"
													>
														{renderPromotedDataValue(
															getValueAtFirstAvailableDataPath(
																objectItem.data,
																column.paths,
															),
														)}
													</td>
												))}
												{activeComputedColumns.map((column) => {
													const result = getComputedColumnResult(
														objectItem,
														column,
													);
													return (
														<td
															key={column.id}
															className="object-data-field-cell"
															data-column-key={`computed:${column.id}`}
															title={
																result.error
																	? `${result.error.code}: ${result.error.message}`
																	: undefined
															}
														>
															{result.error ? (
																<span className="error-banner">Error</span>
															) : (
																renderPromotedDataValue(result.value)
															)}
														</td>
													);
												})}
												{showRawDataColumn ? (
													<td className="data-cell">
														{renderObjectDataPreview(
															objectItem.data,
															activeDataColumns.flatMap(
																(column) => column.paths,
															),
														)}
													</td>
												) : null}
											</tr>
										);
									})}
								</tbody>
							</table>
						</section>
					</>
				)}
				{serverGroupingField && objectAggregatesQuery.data ? (
					objectAggregatesQuery.data.nextCursor ||
					aggregateCursorHistory.length > 0 ||
					objectAggregatesQuery.data.prevCursor ? (
						<TablePagination
							hasNextPage={Boolean(objectAggregatesQuery.data.nextCursor)}
							hasPrevPage={
								aggregateCursorHistory.length > 0 ||
								Boolean(objectAggregatesQuery.data.prevCursor)
							}
							onNextPage={() => {
								const nextCursor = objectAggregatesQuery.data?.nextCursor;
								if (nextCursor) goToNextAggregatePage(nextCursor);
							}}
							onPrevPage={() =>
								goToPreviousAggregatePage(
									objectAggregatesQuery.data?.prevCursor ?? undefined,
								)
							}
							onFirstPage={goToFirstAggregatePage}
							currentCount={serverAggregateGroups.length}
							totalCount={objectAggregatesQuery.data.totalCount}
						/>
					) : null
				) : pageData &&
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
						currentCount={objects.length}
						totalCount={pageData.totalCount}
					/>
				) : null}
			</div>
		</div>
	);
}
