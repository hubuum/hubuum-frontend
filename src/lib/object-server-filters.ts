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

export type ObjectServerFilterDataType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "ip"
	| "array"
	| "object"
	| "unknown";

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
	| "array_length"
	| "all"
	| "within_network"
	| "contains_network"
	| "contains_ip"
	| "overlaps_network"
	| "inet_equals";

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
	"like",
	"regex",
	"in",
	"between",
	"is_null",
	"has_key",
	"array_length",
	"all",
	"within_network",
	"contains_network",
	"contains_ip",
	"overlaps_network",
	"inet_equals",
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSchemaVariants(schema: unknown): Record<string, unknown>[] {
	if (!isRecord(schema)) return [];
	const variants = [schema];
	for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
		const children = schema[keyword];
		if (!Array.isArray(children)) continue;
		for (const child of children) {
			variants.push(...getSchemaVariants(child));
		}
	}
	return variants;
}

function getChildSchema(schema: unknown, segment: string): unknown {
	const arrayIndex = segment.match(/^\[(?:#|\d+)]$/);
	for (const variant of getSchemaVariants(schema)) {
		if (arrayIndex) {
			const index =
				segment === "[#]" ? 0 : Number.parseInt(segment.slice(1), 10);
			if (Array.isArray(variant.prefixItems) && variant.prefixItems[index]) {
				return variant.prefixItems[index];
			}
			if (isRecord(variant.items)) return variant.items;
			continue;
		}

		if (isRecord(variant.properties) && segment in variant.properties) {
			return variant.properties[segment];
		}
	}
	return undefined;
}

const DATE_SCHEMA_FORMATS = new Set(["date", "date-time"]);
const IP_SCHEMA_FORMATS = new Set([
	"ipv4",
	"ipv6",
	"ip",
	"ip-address",
	"inet",
	"cidr",
	"ipv4-cidr",
	"ipv6-cidr",
]);

function getSchemaDataTypes(schema: unknown): Set<ObjectServerFilterDataType> {
	const types = new Set<ObjectServerFilterDataType>();
	for (const variant of getSchemaVariants(schema)) {
		const format =
			typeof variant.format === "string" ? variant.format.toLowerCase() : "";
		if (DATE_SCHEMA_FORMATS.has(format)) {
			types.add("date");
			continue;
		}
		if (IP_SCHEMA_FORMATS.has(format)) {
			types.add("ip");
			continue;
		}

		const rawTypes = Array.isArray(variant.type)
			? variant.type
			: [variant.type];
		for (const rawType of rawTypes) {
			if (rawType === "integer" || rawType === "number") {
				types.add("number");
			} else if (
				rawType === "string" ||
				rawType === "boolean" ||
				rawType === "array" ||
				rawType === "object"
			) {
				types.add(rawType);
			}
		}
		if (!rawTypes.some((rawType) => rawType !== undefined)) {
			if (isRecord(variant.properties)) types.add("object");
			if (variant.items !== undefined || variant.prefixItems !== undefined) {
				types.add("array");
			}
		}
	}
	return types;
}

export function getJsonSchemaServerFilterDataType(
	jsonSchema: unknown,
	path: readonly string[],
): ObjectServerFilterDataType | null {
	let schema = jsonSchema;
	for (const segment of path) {
		schema = getChildSchema(schema, segment);
		if (schema === undefined) return null;
	}

	const types = getSchemaDataTypes(schema);
	return types.size === 1 ? [...types][0] : types.size > 1 ? "unknown" : null;
}

function isCalendarDate(value: string): boolean {
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return false;
	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

function isRfc3339Timestamp(value: string): boolean {
	const match = value.match(
		/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i,
	);
	if (!match || !isCalendarDate(match[1])) return false;
	if (
		Number.parseInt(match[2], 10) > 23 ||
		Number.parseInt(match[3], 10) > 59 ||
		Number.parseInt(match[4], 10) > 59
	) {
		return false;
	}
	return Number.isFinite(Date.parse(value));
}

function isIpv4Address(value: string): boolean {
	const octets = value.split(".");
	return (
		octets.length === 4 &&
		octets.every(
			(octet) =>
				/^(?:0|[1-9]\d{0,2})$/.test(octet) && Number.parseInt(octet, 10) <= 255,
		)
	);
}

function isIpOrNetwork(value: string): boolean {
	const slashIndex = value.lastIndexOf("/");
	const address = slashIndex >= 0 ? value.slice(0, slashIndex) : value;
	const prefix = slashIndex >= 0 ? value.slice(slashIndex + 1) : null;

	if (address.includes(":")) {
		if (
			prefix !== null &&
			(!/^\d{1,3}$/.test(prefix) || Number.parseInt(prefix, 10) > 128)
		) {
			return false;
		}
		try {
			return new URL(`http://[${address}]/`).hostname.length > 2;
		} catch {
			return false;
		}
	}

	return (
		isIpv4Address(address) &&
		(prefix === null ||
			(/^\d{1,2}$/.test(prefix) && Number.parseInt(prefix, 10) <= 32))
	);
}

function inferValueDataType(value: unknown): ObjectServerFilterDataType | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	if (Array.isArray(value)) return "array";
	if (isRecord(value)) return "object";
	if (typeof value !== "string") return "unknown";
	if (isCalendarDate(value) || isRfc3339Timestamp(value)) return "date";
	if (isIpOrNetwork(value)) return "ip";
	return "string";
}

export function inferObjectServerFilterDataType(
	values: readonly unknown[],
): ObjectServerFilterDataType {
	const types = new Set(
		values
			.map(inferValueDataType)
			.filter((type): type is ObjectServerFilterDataType => type !== null),
	);
	return types.size === 1 ? [...types][0] : "unknown";
}

function shiftCalendarDate(date: Date, amount: number, unit: "y" | "mo"): Date {
	const shifted = new Date(date);
	const day = shifted.getUTCDate();
	shifted.setUTCDate(1);
	if (unit === "y") {
		shifted.setUTCFullYear(shifted.getUTCFullYear() + amount);
	} else {
		shifted.setUTCMonth(shifted.getUTCMonth() + amount);
	}
	const lastDayOfMonth = new Date(
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
	).getUTCDate();
	shifted.setUTCDate(Math.min(day, lastDayOfMonth));
	return shifted;
}

function resolveRelativeDatePart(value: string, now: Date): string {
	const trimmed = value.trim();
	if (!Number.isFinite(now.getTime())) return trimmed;
	if (trimmed.toLowerCase() === "now") return now.toISOString();

	const match = trimmed.match(/^([+-])(\d+)(mo|y|w|d|h|m|s)$/i);
	if (!match) return trimmed;
	const magnitude = Number.parseInt(match[2], 10);
	if (!Number.isSafeInteger(magnitude)) return trimmed;
	const amount = match[1] === "-" ? -magnitude : magnitude;
	const unit = match[3].toLowerCase();
	const resolved =
		unit === "y" || unit === "mo"
			? shiftCalendarDate(now, amount, unit)
			: new Date(
					now.getTime() +
						amount *
							{
								w: 7 * 24 * 60 * 60_000,
								d: 24 * 60 * 60_000,
								h: 60 * 60_000,
								m: 60_000,
								s: 1_000,
							}[unit as "w" | "d" | "h" | "m" | "s"],
				);
	return Number.isFinite(resolved.getTime()) ? resolved.toISOString() : trimmed;
}

export function resolveObjectServerFilterRelativeDates(
	value: string,
	now = new Date(),
): string {
	return value
		.split(",")
		.map((part) => resolveRelativeDatePart(part, now))
		.join(",");
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
	if (trimmedValue.length > 500) return null;

	if (
		(field === "name" || field === "description") &&
		(!trimmedValue || !STRING_OPERATORS.has(baseOperator))
	) {
		return null;
	}
	if (
		(field === "id" || field === "collection_id") &&
		(!trimmedValue ||
			!NUMBER_OPERATORS.has(baseOperator) ||
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
		if (baseOperator === "is_null") {
			return { field, operator, value: "", path };
		}
		if (!trimmedValue) return null;
		if (baseOperator === "array_length" && !/^\d+$/.test(trimmedValue)) {
			return null;
		}
		if (
			baseOperator === "between" &&
			(trimmedValue.split(",").length !== 2 ||
				trimmedValue.split(",").some((item) => !item.trim()))
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
			) ||
			!trimmedValue
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
				? getBaseOperator(normalized.operator) === "is_null"
					? (normalized.path?.join(",") ?? "")
					: `${normalized.path?.join(",")}=${normalized.value}`
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
