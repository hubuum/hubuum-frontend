import { z } from "zod";
import type {
	StructuredSearchExpression,
	StructuredSearchField,
	StructuredSearchFieldPredicate,
	StructuredSearchOperator,
	StructuredSearchRequest,
} from "@/lib/api/generated/models";

export const SEARCH_TARGETS = [
	"collection",
	"class",
	"object",
	"audit_event",
	"user",
	"group",
	"service_account",
] as const;
export type SearchTarget = (typeof SEARCH_TARGETS)[number];
type ValueKind =
	| "text"
	| "integer"
	| "date"
	| "boolean"
	| "collection"
	| "json";
type FieldConfig = {
	field: StructuredSearchField;
	label: string;
	type: ValueKind;
	targets: readonly SearchTarget[];
};
const all = [
	"collection",
	"class",
	"object",
	"user",
	"group",
	"service_account",
] as const;
export const SEARCH_FIELDS: readonly FieldConfig[] = [
	{ field: "id", label: "ID", type: "integer", targets: SEARCH_TARGETS },
	{ field: "name", label: "Name", type: "text", targets: all },
	{
		field: "description",
		label: "Description",
		type: "text",
		targets: ["collection", "class", "object", "group", "service_account"],
	},
	{ field: "created_at", label: "Created", type: "date", targets: all },
	{ field: "updated_at", label: "Updated", type: "date", targets: all },
	{ field: "revision", label: "Revision", type: "integer", targets: all },
	{
		field: "collection_id",
		label: "Collection",
		type: "collection",
		targets: ["class", "object", "audit_event"],
	},
	{
		field: "validate_schema",
		label: "Validate schema",
		type: "boolean",
		targets: ["class"],
	},
	{
		field: "json_schema",
		label: "JSON schema",
		type: "json",
		targets: ["class"],
	},
	{ field: "json_data", label: "JSON data", type: "json", targets: ["object"] },
	{
		field: "identity_scope",
		label: "Identity scope",
		type: "text",
		targets: ["user", "group", "service_account"],
	},
	{
		field: "proper_name",
		label: "Display name",
		type: "text",
		targets: ["user"],
	},
	{ field: "email", label: "Email", type: "text", targets: ["user"] },
	{
		field: "occurred_at",
		label: "Occurred at",
		type: "date",
		targets: ["audit_event"],
	},
	{
		field: "entity_type",
		label: "Entity type",
		type: "text",
		targets: ["audit_event"],
	},
	{
		field: "entity_id",
		label: "Entity ID",
		type: "integer",
		targets: ["audit_event"],
	},
	{
		field: "entity_name",
		label: "Entity name",
		type: "text",
		targets: ["audit_event"],
	},
	{ field: "action", label: "Action", type: "text", targets: ["audit_event"] },
	{
		field: "actor_kind",
		label: "Actor kind",
		type: "text",
		targets: ["audit_event"],
	},
	{
		field: "actor_user_id",
		label: "Actor principal ID",
		type: "integer",
		targets: ["audit_event"],
	},
	{
		field: "initiator_user_id",
		label: "Initiator principal ID",
		type: "integer",
		targets: ["audit_event"],
	},
	{
		field: "summary",
		label: "Summary",
		type: "text",
		targets: ["audit_event"],
	},
	{
		field: "metadata",
		label: "Metadata",
		type: "json",
		targets: ["audit_event"],
	},
	{
		field: "managed_by",
		label: "Managed by",
		type: "text",
		targets: ["group"],
	},
	{
		field: "external_key",
		label: "External key",
		type: "text",
		targets: ["group"],
	},
	{
		field: "last_sync_attempted_at",
		label: "Last sync attempt",
		type: "date",
		targets: ["group"],
	},
	{
		field: "last_sync_success_at",
		label: "Last successful sync",
		type: "date",
		targets: ["group"],
	},
	{
		field: "owner_group_id",
		label: "Owner group ID",
		type: "integer",
		targets: ["service_account"],
	},
	{
		field: "created_by",
		label: "Created by principal ID",
		type: "integer",
		targets: ["service_account"],
	},
	{
		field: "disabled_at",
		label: "Disabled at",
		type: "date",
		targets: ["service_account"],
	},
];
const textOperators: StructuredSearchOperator[] = [
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
];
const orderedOperators: StructuredSearchOperator[] = [
	"equals",
	"in",
	"gt",
	"gte",
	"lt",
	"lte",
	"between",
	"is_null",
];
export function fieldOperators(type: ValueKind): StructuredSearchOperator[] {
	if (type === "text") return textOperators;
	if (type === "boolean") return ["equals", "is_null"];
	if (type === "json")
		return [
			...new Set([
				...textOperators,
				...orderedOperators,
				"within_network",
				"contains_network",
				"contains_ip",
				"overlaps_network",
				"inet_equals",
				"all",
				"array_length",
				"has_key",
			]),
		] as StructuredSearchOperator[];
	return orderedOperators;
}
export const OPERATOR_LABELS: Partial<
	Record<StructuredSearchOperator, string>
> = {
	equals: "is",
	in: "is any of",
	icontains: "contains (ignore case)",
	iequals: "is (ignore case)",
	is_null: "is missing / null",
	gt: "greater than",
	gte: "at least",
	lt: "less than",
	lte: "at most",
	between: "between",
};
export function fieldsFor(target: SearchTarget) {
	return SEARCH_FIELDS.filter((field) => field.targets.includes(target));
}
export function sortsFor(target: SearchTarget) {
	const permitted =
		target === "audit_event"
			? ["id", "occurred_at"]
			: target === "group"
				? ["id", "name", "description", "created_at", "updated_at", "revision"]
				: target === "service_account"
					? [
							"id",
							"name",
							"identity_scope",
							"created_at",
							"updated_at",
							"revision",
						]
					: undefined;
	return fieldsFor(target).filter(
		(field) =>
			field.type !== "json" &&
			field.type !== "boolean" &&
			(!permitted || permitted.includes(field.field)),
	);
}

const conditionSchema = z.strictObject({
	field: z.string(),
	operator: z.string(),
	path: z.string(),
	valueType: z.enum(["text", "number", "boolean", "date"]),
	values: z.array(z.string()).max(50),
});
export type SearchCondition = z.infer<typeof conditionSchema>;
export type SearchNode = { id: string; negate: boolean } & (
	| { kind: "field"; condition: SearchCondition }
	| { kind: "group"; mode: "and" | "or"; children: SearchNode[] }
	| {
			kind: "related";
			classId: string;
			depth: string;
			filters: SearchCondition[];
	  }
);
const nodeSchema: z.ZodType<SearchNode> = z.lazy(() =>
	z.discriminatedUnion("kind", [
		z.strictObject({
			id: z.string(),
			negate: z.boolean(),
			kind: z.literal("field"),
			condition: conditionSchema,
		}),
		z.strictObject({
			id: z.string(),
			negate: z.boolean(),
			kind: z.literal("group"),
			mode: z.enum(["and", "or"]),
			children: z.array(nodeSchema).max(64),
		}),
		z.strictObject({
			id: z.string(),
			negate: z.boolean(),
			kind: z.literal("related"),
			classId: z.string(),
			depth: z.string(),
			filters: z.array(conditionSchema).max(16),
		}),
	]),
);
export const searchDraftSchema = z.strictObject({
	version: z.literal(1),
	target: z.enum(SEARCH_TARGETS),
	classId: z.string(),
	filter: nodeSchema,
	sort: z
		.array(
			z.strictObject({ field: z.string(), direction: z.enum(["asc", "desc"]) }),
		)
		.min(1)
		.max(8),
	limit: z.number().int().min(1).max(250),
	hydration: z
		.strictObject({
			classId: z.string(),
			depth: z.number().int().min(1).max(10),
			limit: z.number().int().min(1).max(50),
		})
		.nullable()
		.default(null),
});
export type SearchDraft = z.infer<typeof searchDraftSchema>;
export function emptyCondition(): SearchCondition {
	return {
		field: "name",
		operator: "icontains",
		path: "",
		valueType: "text",
		values: [""],
	};
}
export function newSearchNode(kind: SearchNode["kind"] = "field"): SearchNode {
	const common = { id: crypto.randomUUID(), negate: false };
	if (kind === "group")
		return { ...common, kind, mode: "and", children: [newSearchNode()] };
	if (kind === "related")
		return {
			...common,
			kind,
			classId: "",
			depth: "1",
			filters: [emptyCondition()],
		};
	return { ...common, kind, condition: emptyCondition() };
}
export function emptySearchDraft(): SearchDraft {
	return {
		version: 1,
		target: "object",
		classId: "",
		filter: newSearchNode("group"),
		sort: [{ field: "name", direction: "asc" }],
		limit: 25,
		hydration: null,
	};
}

export function resourceId(value: string, label: string): number {
	const id = Number(value);
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 2147483647)
		throw new Error(`${label}: select a resource with a positive 32-bit ID.`);
	return id;
}
export function dateInputValue(value: string): string {
	// Display restored offsets in UTC without changing the saved instant.
	return z.iso.datetime({ offset: true }).safeParse(value).success
		? new Date(value).toISOString().slice(0, -1)
		: value;
}
function scalarValue(
	raw: string,
	type: ValueKind | SearchCondition["valueType"],
): string | number | boolean {
	if (!raw.trim()) throw new Error("Enter a value.");
	if (type === "collection") return resourceId(raw, "Collection");
	if (type === "integer" || type === "number") {
		const value = Number(raw);
		if (
			!Number.isFinite(value) ||
			(type === "integer" &&
				(!/^-?\d+$/.test(raw) || !Number.isSafeInteger(value)))
		)
			throw new Error(
				type === "integer" ? "Enter a whole number." : "Enter a finite number.",
			);
		return value;
	}
	if (type === "boolean") {
		if (raw !== "true" && raw !== "false")
			throw new Error("Choose true or false.");
		return raw === "true";
	}
	if (type === "date") {
		// The UI uses UTC datetime-local controls; bookmarks may include an explicit offset.
		const value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(
			raw,
		)
			? `${raw.length === 16 ? `${raw}:00` : raw}Z`
			: raw;
		if (!z.iso.datetime({ offset: true }).safeParse(value).success)
			throw new Error("Enter a valid date and time (UTC).");
		return value;
	}
	return raw;
}
export function buildFieldPredicate(
	condition: SearchCondition,
	target: SearchTarget,
): StructuredSearchFieldPredicate {
	const field = fieldsFor(target).find(
		(item) => item.field === condition.field,
	);
	if (!field)
		throw new Error(
			`Field “${condition.field}” is incompatible with ${target} searches. Choose another field or remove this condition.`,
		);
	const operator = fieldOperators(field.type).find(
		(item) => item === condition.operator,
	);
	if (!operator)
		throw new Error(
			`Operator “${condition.operator}” is not valid for ${field.label}.`,
		);
	const predicate: StructuredSearchFieldPredicate = {
		field: field.field,
		operator,
	};
	if (field.type === "json") {
		if (!/^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*$/.test(condition.path))
			throw new Error(
				"JSON path: use non-empty dot-separated segments containing letters, numbers, _ or $.",
			);
		predicate.path = condition.path;
	} else if (condition.path)
		throw new Error(`${field.label} does not accept a JSON path.`);
	if (operator === "is_null") return predicate;
	const array =
		operator === "in" || operator === "all" || operator === "between";
	if (
		!condition.values.length ||
		condition.values.length > 50 ||
		(!array && condition.values.length !== 1) ||
		(operator === "between" && condition.values.length !== 2)
	)
		throw new Error(
			operator === "between"
				? "Enter exactly two range bounds."
				: array
					? "Enter between 1 and 50 values."
					: "Enter exactly one value.",
		);
	const type = field.type === "json" ? condition.valueType : field.type;
	const values = condition.values.map((value) => scalarValue(value, type));
	if (
		values.some((value) => typeof value === "string" && value.includes(",")) &&
		operator !== "regex"
	)
		throw new Error("Values cannot contain commas for this operator.");
	const bounds =
		type === "date" ? values.map((value) => Date.parse(String(value))) : values;
	if (operator === "between" && bounds[0] > bounds[1])
		throw new Error("The lower range bound must not exceed the upper bound.");
	if (
		[
			"within_network",
			"contains_network",
			"overlaps_network",
			"inet_equals",
			"contains_ip",
		].includes(operator)
	) {
		const address = z.union([z.ipv4(), z.ipv6()]);
		const network = z.union([z.cidrv4(), z.cidrv6()]);
		if (
			!(
				operator === "contains_ip" ? address : z.union([address, network])
			).safeParse(values[0]).success
		)
			throw new Error("Enter a valid IP address or network in a text value.");
	}
	if (
		operator === "array_length" &&
		(typeof values[0] !== "number" ||
			!Number.isInteger(values[0]) ||
			values[0] < 0)
	)
		throw new Error("Array length requires a non-negative whole number.");
	predicate.value = array ? values : values[0];
	return predicate;
}

/** Validate the whole draft before producing any executable request. */
export function buildAdvancedSearch(
	draft: SearchDraft,
): StructuredSearchRequest {
	searchDraftSchema.parse(draft);
	if (draft.hydration) {
		if (draft.target !== "object")
			throw new Error(
				"Related-resource inspection requires the Objects target. Disable inspection or change the target.",
			);
		resourceId(draft.hydration.classId, "Related-resource class");
	}
	let nodes = 0;
	let fields = 0;
	let related = 0;
	const ids = new Set<string>();
	function build(
		node: SearchNode,
		depth: number,
		location: string,
	): StructuredSearchExpression {
		if (ids.has(node.id))
			throw new Error(
				"Query contains duplicate condition identifiers. Rebuild the duplicated group.",
			);
		ids.add(node.id);
		nodes += node.negate ? 2 : 1;
		if (nodes > 64 || depth + Number(node.negate) > 8)
			throw new Error(
				"Use at most 64 expression nodes and 8 nesting levels (including NOT).",
			);
		let expression: StructuredSearchExpression;
		try {
			if (node.kind === "group") {
				if (!node.children.length)
					throw new Error(
						"Empty groups cannot run. Add a condition or remove this group.",
					);
				const args = node.children.map((child, index) =>
					build(
						child,
						depth + 1 + Number(node.negate),
						`${location}.${index + 1}`,
					),
				);
				expression = args.length === 1 ? args[0] : { op: node.mode, args };
			} else if (node.kind === "related") {
				if (draft.target !== "object")
					throw new Error(
						"Related-object conditions require the Objects target. Remove the condition or change the target.",
					);
				if (++related > 4)
					throw new Error("Use at most four related-object conditions.");
				const depth = Number(node.depth);
				if (!/^\d+$/.test(node.depth) || depth < 1 || depth > 10)
					throw new Error("Related traversal depth must be from 1 to 10.");
				fields += node.filters.length;
				expression = {
					op: "related",
					predicate: {
						class: { id: resourceId(node.classId, "Related class") },
						depth,
						filters: node.filters.map((filter) =>
							buildFieldPredicate(filter, "object"),
						),
					},
				};
			} else {
				fields++;
				expression = {
					op: "field",
					predicate: buildFieldPredicate(node.condition, draft.target),
				};
			}
		} catch (error) {
			throw new Error(
				`${location}: ${error instanceof Error ? error.message : "Invalid condition"}`,
			);
		}
		return node.negate ? { op: "not", arg: expression } : expression;
	}
	const filter = build(draft.filter, 1, "Filter");
	if (fields > 32)
		throw new Error(
			"Use at most 32 field conditions, including related-object filters.",
		);
	if (draft.target !== "object" && draft.classId)
		throw new Error(
			"The exact class selection requires the Objects target. Clear it or change the target.",
		);
	const seenSort = new Set<string>();
	const sort = draft.sort.map((sort) => {
		const field = sortsFor(draft.target).find(
			(field) => field.field === sort.field,
		);
		if (!field || seenSort.has(sort.field))
			throw new Error(
				`Sort field “${sort.field}” is unsupported or repeated. Choose a valid sort field.`,
			);
		seenSort.add(sort.field);
		return { field: field.field, direction: sort.direction };
	});
	const request: StructuredSearchRequest = {
		version: 1,
		target:
			draft.target === "object" && draft.classId
				? {
						kind: "object",
						class: { id: resourceId(draft.classId, "Object class") },
					}
				: { kind: draft.target },
		filter,
		sort,
		limit: draft.limit,
		include_total: true,
	};
	if (new TextEncoder().encode(JSON.stringify(request)).length > 60 * 1024)
		throw new Error(
			"Query is too large. Shorten values or remove conditions to leave room for pagination.",
		);
	return request;
}

export function restoreAdvancedSearch(raw: string): SearchDraft {
	if (raw.length > 64 * 1024) throw new Error("Saved query is too large.");
	const value: unknown = JSON.parse(raw);
	// Bound recursion before passing untrusted bookmark data to the recursive schema.
	function bound(value: unknown, depth: number): void {
		if (depth > 24) throw new Error("Saved query is nested too deeply.");
		if (value && typeof value === "object")
			for (const child of Object.values(value)) bound(child, depth + 1);
	}
	bound(value, 0);
	return searchDraftSchema.parse(value);
}

export function advancedSearchUrl(draft: SearchDraft): string {
	const url = `/search/advanced?${new URLSearchParams({ query: JSON.stringify(draft) })}`;
	// The encoded URL is ASCII. Leave header room for cookies, a same-origin
	// Referer containing another query, and framework headers.
	if (url.length > 4 * 1024)
		throw new Error(
			"This query is too large to bookmark. You can still run it, but refreshing will clear it. Shorten values or remove conditions to enable bookmarking.",
		);
	return url;
}
