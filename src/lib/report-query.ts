import type {
	QueryFieldDefinition,
	QueryFieldKind,
} from "@/lib/report-scope-fields";

export type ReportQueryFilter = {
	field: string;
	operator: string;
	value: string;
};

export type ReportQuerySort = {
	field: string;
	direction: "asc" | "desc";
};

export type ParsedReportQuery = {
	filters: ReportQueryFilter[];
	sorts: ReportQuerySort[];
	advancedQuery: string;
};

const STRING_OPERATORS = [
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
] as const;
const NUMBER_OPERATORS = [
	"equals",
	"gt",
	"gte",
	"lt",
	"lte",
	"between",
] as const;
const ARRAY_OPERATORS = ["equals", "contains"] as const;
const BOOLEAN_OPERATORS = ["equals"] as const;
const JSON_OPERATORS = [
	"equals",
	"contains",
	"gt",
	"gte",
	"lt",
	"lte",
	"between",
] as const;

export function getReportQueryOperators(
	kind: QueryFieldKind,
): readonly string[] {
	if (kind === "number" || kind === "date") return NUMBER_OPERATORS;
	if (kind === "boolean") return BOOLEAN_OPERATORS;
	if (kind === "array") return ARRAY_OPERATORS;
	if (kind === "json") return JSON_OPERATORS;
	return STRING_OPERATORS;
}

export function formatReportQueryField(value: string): string {
	return value
		.replaceAll("_", " ")
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatReportQueryOperator(value: string): string {
	const labels: Record<string, string> = {
		equals: "Equals",
		iequals: "Equals, ignoring case",
		contains: "Contains",
		icontains: "Contains, ignoring case",
		startswith: "Starts with",
		istartswith: "Starts with, ignoring case",
		endswith: "Ends with",
		iendswith: "Ends with, ignoring case",
		like: "Matches pattern",
		regex: "Matches regular expression",
		gt: "Greater than",
		gte: "Greater than or equal to",
		lt: "Less than",
		lte: "Less than or equal to",
		between: "Between",
	};

	return labels[value] ?? value;
}

export function buildReportQuery(
	filters: readonly ReportQueryFilter[],
	sorts: readonly ReportQuerySort[],
	advancedQuery: string,
): string {
	const params = new URLSearchParams();

	for (const filter of filters) {
		if (!filter.field || !filter.value.trim()) continue;
		const key =
			filter.operator === "equals"
				? filter.field
				: `${filter.field}__${filter.operator}`;
		params.append(key, filter.value.trim());
	}

	const sortValue = sorts
		.filter((sort) => sort.field)
		.map((sort) => `${sort.field}.${sort.direction}`)
		.join(",");
	if (sortValue) params.set("sort", sortValue);

	const advancedParams = new URLSearchParams(
		advancedQuery.startsWith("?") ? advancedQuery.slice(1) : advancedQuery,
	);
	advancedParams.forEach((value, key) => {
		if (key !== "cursor") params.append(key, value);
	});

	return params.toString();
}

export function parseReportQuery(
	query: string,
	fields: readonly QueryFieldDefinition[],
): ParsedReportQuery {
	const filters: ReportQueryFilter[] = [];
	const sorts: ReportQuerySort[] = [];
	const advancedParams = new URLSearchParams();
	const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
	const params = new URLSearchParams(
		query.startsWith("?") ? query.slice(1) : query,
	);

	params.forEach((value, key) => {
		if (key === "sort") {
			for (const part of value.split(",")) {
				const [field, direction = "asc"] = part.split(".");
				if (
					fieldsByKey.get(field)?.sortable &&
					(direction === "asc" || direction === "desc")
				) {
					sorts.push({ field, direction });
				} else {
					advancedParams.append("sort", part);
				}
			}
			return;
		}

		let field = key;
		let operator = "equals";
		const operatorIndex = key.lastIndexOf("__");
		if (operatorIndex > 0) {
			field = key.slice(0, operatorIndex);
			operator = key.slice(operatorIndex + 2);
		}
		const fieldDefinition = fieldsByKey.get(field);
		if (
			fieldDefinition &&
			getReportQueryOperators(fieldDefinition.kind).includes(operator)
		) {
			filters.push({ field, operator, value });
		} else {
			advancedParams.append(key, value);
		}
	});

	return {
		filters,
		sorts,
		advancedQuery: advancedParams.toString(),
	};
}
