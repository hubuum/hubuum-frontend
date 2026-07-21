export const OBJECT_SERVER_FILTERS_QUERY_KEY = "objectFilters";
export const MAX_OBJECT_SERVER_FILTERS = 8;
export const MAX_OBJECT_COMPUTED_FILTERS = 2;

export type ObjectComputedFilterScope = "shared" | "personal";
export type ObjectComputedResultType =
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "object"
	| "array";

export type ObjectServerFilterField =
	| "name"
	| "description"
	| "id"
	| "collection_id"
	| "json_data"
	| "computed";

export type ObjectServerFilterBaseOperator =
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
	| "lte"
	| "like"
	| "regex"
	| "in"
	| "between"
	| "is_null"
	| "has_key"
	| "array_length";

export type ObjectServerFilterOperator =
	| ObjectServerFilterBaseOperator
	| `not_${ObjectServerFilterBaseOperator}`;

export type ObjectServerFilter = {
	field: ObjectServerFilterField;
	operator: ObjectServerFilterOperator;
	value: string;
	path?: string[];
	computedScope?: ObjectComputedFilterScope;
	computedKey?: string;
	computedResultType?: ObjectComputedResultType;
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
	"computed",
]);
const COMPUTED_SCOPES = new Set<ObjectComputedFilterScope>([
	"shared",
	"personal",
]);
const COMPUTED_RESULT_TYPES = new Set<ObjectComputedResultType>([
	"string",
	"number",
	"integer",
	"boolean",
	"object",
	"array",
]);
const COMPUTED_OPERATORS: Record<
	ObjectComputedResultType,
	ReadonlySet<ObjectServerFilterBaseOperator>
> = {
	string: new Set([
		"equals",
		"iequals",
		"contains",
		"icontains",
		"startswith",
		"istartswith",
		"endswith",
		"iendswith",
		"like",
		"regex",
		"in",
		"is_null",
	]),
	number: new Set([
		"equals",
		"in",
		"gt",
		"gte",
		"lt",
		"lte",
		"between",
		"is_null",
	]),
	integer: new Set([
		"equals",
		"in",
		"gt",
		"gte",
		"lt",
		"lte",
		"between",
		"is_null",
	]),
	boolean: new Set(["equals", "is_null"]),
	object: new Set(["equals", "contains", "has_key", "is_null"]),
	array: new Set(["equals", "contains", "has_key", "array_length", "is_null"]),
};

function getBaseOperator(
	operator: ObjectServerFilterOperator,
): ObjectServerFilterBaseOperator {
	return operator.startsWith("not_")
		? (operator.slice(4) as ObjectServerFilterBaseOperator)
		: (operator as ObjectServerFilterBaseOperator);
}

function isValidComputedValue(
	resultType: ObjectComputedResultType,
	operator: ObjectServerFilterBaseOperator,
	value: string,
): boolean {
	if (operator === "is_null") return value === "true" || value === "false";
	if (resultType === "boolean") {
		return value === "true" || value === "false";
	}
	if (operator === "array_length") {
		return /^\d+$/.test(value);
	}
	if (resultType === "number" || resultType === "integer") {
		const values =
			operator === "in" || operator === "between"
				? value.split(",").map((item) => item.trim())
				: [value];
		if (operator === "between" && values.length !== 2) return false;
		return (
			values.length > 0 &&
			values.every((item) => item && Number.isFinite(Number(item)))
		);
	}
	if (
		(resultType === "object" || resultType === "array") &&
		(operator === "equals" || operator === "contains")
	) {
		try {
			const parsed: unknown = JSON.parse(value);
			return resultType === "array"
				? Array.isArray(parsed)
				: Boolean(parsed) &&
						typeof parsed === "object" &&
						!Array.isArray(parsed);
		} catch {
			return false;
		}
	}
	return true;
}

function limitComputedFilters(
	filters: readonly ObjectServerFilter[],
): ObjectServerFilter[] {
	let computedCount = 0;
	return filters.filter((filter) => {
		if (filter.field !== "computed") return true;
		computedCount += 1;
		return computedCount <= MAX_OBJECT_COMPUTED_FILTERS;
	});
}

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
	const baseOperator = getBaseOperator(operator);
	const trimmedValue = candidate.value.trim();
	if (!trimmedValue || trimmedValue.length > 500) return null;

	if (
		(field === "name" || field === "description") &&
		!STRING_OPERATORS.has(baseOperator)
	) {
		return null;
	}
	if (
		(field === "id" || field === "collection_id") &&
		(!NUMBER_OPERATORS.has(baseOperator) ||
			!Number.isFinite(Number(trimmedValue)))
	) {
		return null;
	}

	if (field === "json_data") {
		const path = Array.isArray(candidate.path)
			? candidate.path.filter(
					(segment): segment is string => typeof segment === "string",
				)
			: [];
		if (
			!JSON_OPERATORS.has(baseOperator) ||
			!isServerFilterableDataPath(path)
		) {
			return null;
		}
		return { field, operator, value: trimmedValue, path };
	}

	if (field === "computed") {
		if (
			typeof candidate.computedScope !== "string" ||
			!COMPUTED_SCOPES.has(
				candidate.computedScope as ObjectComputedFilterScope,
			) ||
			typeof candidate.computedKey !== "string" ||
			!/^[a-z][a-z0-9_]{0,63}$/.test(candidate.computedKey) ||
			typeof candidate.computedResultType !== "string" ||
			!COMPUTED_RESULT_TYPES.has(
				candidate.computedResultType as ObjectComputedResultType,
			)
		) {
			return null;
		}
		const computedScope = candidate.computedScope as ObjectComputedFilterScope;
		const computedResultType =
			candidate.computedResultType as ObjectComputedResultType;
		if (
			!COMPUTED_OPERATORS[computedResultType].has(baseOperator) ||
			!isValidComputedValue(computedResultType, baseOperator, trimmedValue)
		) {
			return null;
		}
		return {
			field,
			operator,
			value: trimmedValue,
			computedScope,
			computedKey: candidate.computedKey,
			computedResultType,
		};
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
		return limitComputedFilters(
			parsed
				.slice(0, MAX_OBJECT_SERVER_FILTERS)
				.map(normalizeObjectServerFilter)
				.filter((filter): filter is ObjectServerFilter => filter !== null),
		);
	} catch {
		return [];
	}
}

export function serializeObjectServerFilters(
	filters: readonly ObjectServerFilter[],
): string {
	return JSON.stringify(
		limitComputedFilters(
			filters
				.slice(0, MAX_OBJECT_SERVER_FILTERS)
				.map(normalizeObjectServerFilter)
				.filter((filter): filter is ObjectServerFilter => filter !== null),
		),
	);
}

export function appendObjectServerFilters(
	params: URLSearchParams,
	filters: readonly ObjectServerFilter[],
): void {
	for (const filter of limitComputedFilters(filters)) {
		const normalized = normalizeObjectServerFilter(filter);
		if (!normalized) continue;
		const field =
			normalized.field === "computed"
				? `computed.${normalized.computedScope}.${normalized.computedKey}`
				: normalized.field;
		const key = `${field}__${normalized.operator}`;
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
	return [
		filter.field,
		filter.path?.join("."),
		filter.computedScope,
		filter.computedKey,
		filter.operator,
	].join(":");
}

export function getObjectServerFilterLabel(filter: ObjectServerFilter): string {
	if (filter.field === "json_data") {
		return filter.path?.join(" · ") || "Data";
	}
	if (filter.field === "computed") {
		return `${filter.computedScope === "shared" ? "Shared" : "Personal"} · ${filter.computedKey}`;
	}
	return {
		name: "Name",
		description: "Description",
		id: "ID",
		collection_id: "Collection ID",
	}[filter.field];
}
