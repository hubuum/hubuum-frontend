export const OBJECT_SERVER_FILTERS_QUERY_KEY = "objectFilters";
export const MAX_OBJECT_SERVER_FILTERS = 8;

export type ObjectServerFilterField =
	| "name"
	| "description"
	| "id"
	| "collection_id"
	| "json_data";

export type ObjectServerFilterOperator =
	| "equals"
	| "iequals"
	| "contains"
	| "icontains"
	| "startswith"
	| "istartswith"
	| "endswith"
	| "iendswith"
	| "gt"
	| "gte"
	| "lt"
	| "lte";

export type ObjectServerFilter = {
	field: ObjectServerFilterField;
	operator: ObjectServerFilterOperator;
	value: string;
	path?: string[];
};

const STRING_OPERATORS = new Set<ObjectServerFilterOperator>([
	"equals",
	"iequals",
	"contains",
	"icontains",
	"startswith",
	"istartswith",
	"endswith",
	"iendswith",
]);
const NUMBER_OPERATORS = new Set<ObjectServerFilterOperator>([
	"equals",
	"gt",
	"gte",
	"lt",
	"lte",
]);
const JSON_OPERATORS = new Set<ObjectServerFilterOperator>([
	...STRING_OPERATORS,
	...NUMBER_OPERATORS,
]);
const BASE_FIELDS = new Set<ObjectServerFilterField>([
	"name",
	"description",
	"id",
	"collection_id",
	"json_data",
]);

export function isServerFilterableDataPath(path: readonly string[]): boolean {
	return (
		path.length > 0 &&
		path.every(
			(segment) =>
				segment.length > 0 &&
				segment.length <= 64 &&
				/^[A-Za-z0-9_$]+$/.test(segment),
		)
	);
}

export function toServerFilterDataPath(
	path: readonly string[],
): string[] | null {
	const normalized = path.map((segment) => {
		const arrayIndex = segment.match(/^\[(\d+)]$/);
		return arrayIndex ? arrayIndex[1] : segment;
	});
	return isServerFilterableDataPath(normalized) ? normalized : null;
}

export function normalizeObjectServerFilter(
	value: unknown,
): ObjectServerFilter | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.field !== "string" ||
		!BASE_FIELDS.has(candidate.field as ObjectServerFilterField) ||
		typeof candidate.operator !== "string" ||
		typeof candidate.value !== "string"
	) {
		return null;
	}

	const field = candidate.field as ObjectServerFilterField;
	const operator = candidate.operator as ObjectServerFilterOperator;
	const trimmedValue = candidate.value.trim();
	if (!trimmedValue || trimmedValue.length > 500) return null;

	if (
		(field === "name" || field === "description") &&
		!STRING_OPERATORS.has(operator)
	) {
		return null;
	}
	if (
		(field === "id" || field === "collection_id") &&
		(!NUMBER_OPERATORS.has(operator) || !Number.isFinite(Number(trimmedValue)))
	) {
		return null;
	}

	if (field === "json_data") {
		const path = Array.isArray(candidate.path)
			? candidate.path.filter(
					(segment): segment is string => typeof segment === "string",
				)
			: [];
		if (!JSON_OPERATORS.has(operator) || !isServerFilterableDataPath(path)) {
			return null;
		}
		return { field, operator, value: trimmedValue, path };
	}

	return { field, operator, value: trimmedValue };
}

export function parseObjectServerFilters(
	serialized: string | null | undefined,
): ObjectServerFilter[] {
	if (!serialized) return [];
	try {
		const parsed = JSON.parse(serialized);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.slice(0, MAX_OBJECT_SERVER_FILTERS)
			.map(normalizeObjectServerFilter)
			.filter((filter): filter is ObjectServerFilter => filter !== null);
	} catch {
		return [];
	}
}

export function serializeObjectServerFilters(
	filters: readonly ObjectServerFilter[],
): string {
	return JSON.stringify(
		filters
			.slice(0, MAX_OBJECT_SERVER_FILTERS)
			.map(normalizeObjectServerFilter)
			.filter((filter): filter is ObjectServerFilter => filter !== null),
	);
}

export function appendObjectServerFilters(
	params: URLSearchParams,
	filters: readonly ObjectServerFilter[],
): void {
	for (const filter of filters) {
		const normalized = normalizeObjectServerFilter(filter);
		if (!normalized) continue;
		const key = `${normalized.field}__${normalized.operator}`;
		const value =
			normalized.field === "json_data"
				? `${normalized.path?.join(",")}=${normalized.value}`
				: normalized.value;
		params.append(key, value);
	}
}

export function getObjectServerFilterIdentity(
	filter: ObjectServerFilter,
): string {
	return [filter.field, filter.path?.join("."), filter.operator].join(":");
}

export function getObjectServerFilterLabel(
	filter: ObjectServerFilter,
): string {
	if (filter.field === "json_data") {
		return filter.path?.join(" · ") || "Data";
	}
	return {
		name: "Name",
		description: "Description",
		id: "ID",
		collection_id: "Collection ID",
	}[filter.field];
}
