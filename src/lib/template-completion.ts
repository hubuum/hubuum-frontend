import type {
	Completion,
	CompletionContext,
	CompletionResult,
	CompletionSource,
} from "@codemirror/autocomplete";

import type { ReportScopeKind } from "@/lib/api/reporting";
import {
	type FieldDef,
	getScopeObjectFields,
	NAMESPACE_FIELDS,
} from "@/lib/template-suggestions";

export type TemplateCompletionOptions = {
	scopeKind?: ReportScopeKind;
	relationHydrated: boolean;
	relationAliases?: string[];
	templateNames?: string[];
};

const TAGS: Completion[] = [
	{ label: "for", detail: "Loop: for x in items", type: "keyword", boost: 4 },
	{ label: "endfor", detail: "Close a loop block", type: "keyword" },
	{ label: "if", detail: "Start a conditional block", type: "keyword" },
	{ label: "elif", detail: "Else-if branch", type: "keyword" },
	{ label: "else", detail: "Conditional fallback branch", type: "keyword" },
	{ label: "endif", detail: "Close a conditional block", type: "keyword" },
	{ label: "set", detail: "Assign a template variable", type: "keyword" },
	{ label: "macro", detail: "Define a macro", type: "keyword" },
	{ label: "endmacro", detail: "Close a macro", type: "keyword" },
	{ label: "include", detail: "Include a same-namespace template", type: "keyword" },
	{ label: "import", detail: "Import macros from a same-namespace template", type: "keyword" },
	{ label: "extends", detail: "Extend a same-namespace template", type: "keyword" },
];

const FILTERS: Completion[] = [
	{ label: "csv_cell", detail: "Escape a value for a CSV cell", type: "function" },
	{ label: "tojson", detail: "Serialize a value as JSON", type: "function" },
	{ label: "default", detail: "default(fallback) — value when undefined", type: "function" },
	{ label: "default_if_empty", detail: "default_if_empty(fallback) — value when empty", type: "function" },
	{ label: "format_datetime", detail: "format_datetime(fmt) — format a timestamp", type: "function" },
	{ label: "join_nonempty", detail: "join_nonempty(sep) — join non-empty values", type: "function" },
	{ label: "length", detail: "Number of items", type: "function" },
	{ label: "sort", detail: "Sort a sequence", type: "function" },
];

const TESTS: Completion[] = [
	{ label: "defined", detail: "is defined", type: "keyword" },
	{ label: "none", detail: "is none", type: "keyword" },
	{ label: "string", detail: "is string", type: "keyword" },
	{ label: "sequence", detail: "is sequence", type: "keyword" },
];

const FUNCTIONS: Completion[] = [
	{ label: "coalesce", detail: "coalesce(a, b, ...) — first non-null value", type: "function" },
	{ label: "range", detail: "range(n) — sequence of numbers", type: "function" },
];

// Resolver value kinds.
type Kind =
	| { type: "object" }
	| { type: "namespace" }
	| { type: "meta" }
	| { type: "scope" }
	| { type: "request" }
	| { type: "listObject" } // a list whose elements are objects
	| { type: "relatedMap" } // related.* — relation/include aliases
	| { type: "classMap" } // reachable.* / paths.* — class aliases
	| { type: "pathsMap" } // item.paths — class-alias map whose entries carry path + path_objects
	| { type: "pathsEntry" } // an element of paths.<alias>: object fields + path + path_objects
	| { type: "unknown" };

type Segment = { name: string; indexed: boolean };

function fieldCompletion(field: FieldDef): Completion {
	return { label: field.name, detail: field.detail, type: "property" };
}

const RELATION_MAP_PROPS = (relationHydrated: boolean): Completion[] => {
	const props: Completion[] = [];
	props.push({
		label: "related",
		detail: "Adjacent objects grouped by relation alias (list per alias)",
		type: "property",
		boost: 2,
	});
	if (relationHydrated) {
		props.push(
			{
				label: "reachable",
				detail: "Reachable objects grouped by class alias (list per alias)",
				type: "property",
				boost: 2,
			},
			{
				label: "paths",
				detail: "Path-preserving reachable objects grouped by class alias",
				type: "property",
				boost: 2,
			},
		);
	}
	return props;
};

// Parse the access chain ending at the cursor into segments. Returns null when
// the text before the cursor is not an access chain.
function parseChain(text: string): { segments: Segment[]; partial: string } | null {
	const match = text.match(
		/([A-Za-z_][A-Za-z0-9_]*(?:\s*(?:\[(?:\d+|"[^"]*"|'[^']*')\]|\.[A-Za-z_][A-Za-z0-9_]*))*)(\.[A-Za-z0-9_]*)?$/,
	);
	if (!match?.[1]) {
		return null;
	}

	const chain = match[1];
	const trailing = match[2] ?? "";
	const segments: Segment[] = [];
	// Split chain on dots that are not inside brackets.
	for (const raw of chain.split(".")) {
		const nameMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)((?:\[(?:\d+|"[^"]*"|'[^']*')\])*)$/);
		if (!nameMatch) {
			return null;
		}
		segments.push({ name: nameMatch[1], indexed: Boolean(nameMatch[2]) });
	}

	if (trailing) {
		// trailing is ".partial" (partial may be empty when the cursor is right
		// after a dot). The resolved prefix is `segments`; partial is the word.
		return { segments, partial: trailing.slice(1) };
	}

	// No trailing dot: the last segment is itself the partial root word being
	// typed. If there's only one segment with no subscript, it's a root partial.
	if (segments.length === 1 && !segments[0].indexed) {
		return { segments: [], partial: segments[0].name };
	}
	// Otherwise the chain is complete (e.g. ends with `]`); nothing to complete.
	return { segments, partial: "" };
}

function resolveRoot(name: string, options: TemplateCompletionOptions, loopVars: Set<string>): Kind {
	if (loopVars.has(name)) {
		return { type: "object" };
	}
	if (name === "items") {
		return { type: "listObject" };
	}
	if (name === "source" && options.scopeKind === "related_objects") {
		return { type: "object" };
	}
	if (name === "meta") {
		return { type: "meta" };
	}
	if (name === "request") {
		return { type: "request" };
	}
	return { type: "unknown" };
}

function step(kind: Kind, segment: Segment, options: TemplateCompletionOptions): Kind {
	const allowRelations = (mapType: "relatedMap" | "classMap") =>
		mapType === "relatedMap"
			? options.relationHydrated || (options.relationAliases?.length ?? 0) > 0
			: options.relationHydrated;

	switch (kind.type) {
		case "listObject":
			return segment.indexed ? { type: "object" } : { type: "unknown" };
		case "pathsEntry":
		case "object": {
			if (segment.name === "related" && allowRelations("relatedMap")) {
				return { type: "relatedMap" };
			}
			if (segment.name === "reachable" && allowRelations("classMap")) {
				return { type: "classMap" };
			}
			if (segment.name === "paths" && allowRelations("classMap")) {
				return { type: "pathsMap" };
			}
			const field = getScopeObjectFields(options.scopeKind).find((f) => f.name === segment.name);
			if (field?.nested === "namespace") {
				return { type: "namespace" };
			}
			if (segment.name === "path_objects") {
				return segment.indexed ? { type: "object" } : { type: "listObject" };
			}
			return { type: "unknown" };
		}
		case "relatedMap":
		case "classMap":
			// alias -> list of objects; index/loop unwraps to object.
			return segment.indexed ? { type: "object" } : { type: "listObject" };
		case "pathsMap":
			return segment.indexed ? { type: "pathsEntry" } : { type: "listObject" };
		case "meta":
			return segment.name === "scope" ? { type: "scope" } : { type: "unknown" };
		case "request":
			return segment.name === "scope" ? { type: "scope" } : { type: "unknown" };
		default:
			return { type: "unknown" };
	}
}

function completionsForKind(kind: Kind, options: TemplateCompletionOptions): Completion[] {
	switch (kind.type) {
		case "object":
			return [
				...getScopeObjectFields(options.scopeKind).map(fieldCompletion),
				...RELATION_MAP_PROPS(options.relationHydrated),
			];
		case "pathsEntry":
			return [
				...getScopeObjectFields(options.scopeKind).map(fieldCompletion),
				...RELATION_MAP_PROPS(options.relationHydrated),
				{ label: "path", detail: "Traversal path (id list)", type: "property" },
				{ label: "path_objects", detail: "Objects along the traversal path (list)", type: "property" },
			];
		case "namespace":
			return NAMESPACE_FIELDS.map(fieldCompletion);
		case "meta":
			return [
				{ label: "count", detail: "Number of rows", type: "property" },
				{ label: "content_type", detail: "Output content type", type: "property" },
				{ label: "truncated", detail: "Whether the result was truncated", type: "property" },
				{ label: "scope", detail: "Report scope", type: "property" },
			];
		case "scope":
			return [
				{ label: "kind", detail: "Report scope kind", type: "property" },
				{ label: "class_id", detail: "Class id for class-bound scopes", type: "property" },
				{ label: "object_id", detail: "Object id for object-bound scopes", type: "property" },
			];
		case "request":
			return [
				{ label: "scope", detail: "Submitted report scope", type: "property" },
				{ label: "query", detail: "Submitted query string", type: "property" },
			];
		case "relatedMap":
			return (options.relationAliases ?? []).map((alias) => ({
				label: alias,
				detail: "Configured related-object include (list)",
				type: "property",
				boost: 2,
			}));
		// classMap/pathsMap class aliases are not statically known.
		default:
			return [];
	}
}

function rootCompletions(options: TemplateCompletionOptions, loopVars: Set<string>): Completion[] {
	const vars: Completion[] = [
		{ label: "items", detail: "Array of report rows", type: "variable", boost: 4 },
		{ label: "meta", detail: "Report metadata", type: "variable", boost: 3 },
		{ label: "warnings", detail: "Report warnings", type: "variable" },
		{ label: "request", detail: "Submitted report request context", type: "variable" },
	];
	if (options.scopeKind === "related_objects") {
		vars.push({ label: "source", detail: "Hydrated root object", type: "variable", boost: 3 });
	}
	for (const name of loopVars) {
		vars.push({ label: name, detail: "Loop variable", type: "variable", boost: 3 });
	}
	return [...vars, ...FUNCTIONS];
}

// Collect loop variables bound by `{% for X in ... %}` before the cursor.
function collectLoopVars(before: string): Set<string> {
	const vars = new Set<string>();
	const re = /\{%-?\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+/g;
	let m: RegExpExecArray | null = re.exec(before);
	while (m) {
		vars.add(m[1]);
		m = re.exec(before);
	}
	return vars;
}

function result(from: number, optionsList: Completion[]): CompletionResult | null {
	if (!optionsList.length) {
		return null;
	}
	return { from, options: optionsList };
}

export function createTemplateCompletionSource(
	options: TemplateCompletionOptions,
): CompletionSource {
	return (context: CompletionContext): CompletionResult | null => {
		const before = context.state.sliceDoc(0, context.pos);

		// Only complete inside an open {{ ... }} or {% ... %} region.
		const openExpr = before.lastIndexOf("{{");
		const openStmt = before.lastIndexOf("{%");
		const closeExpr = before.lastIndexOf("}}");
		const closeStmt = before.lastIndexOf("%}");
		const openPos = Math.max(openExpr, openStmt);
		const closePos = Math.max(closeExpr, closeStmt);
		if (openPos < 0 || closePos > openPos) {
			return null;
		}
		const inStatement = openStmt > openExpr;
		const region = before.slice(openPos + 2);
		const loopVars = collectLoopVars(before.slice(0, openPos));

		// Inside a string after include/import/extends → offer template names.
		const nameMatch = region.match(
			/\b(?:include|import|extends)\s+("|')([A-Za-z0-9_.\-/]*)$/,
		);
		if (nameMatch) {
			const names = options.templateNames ?? [];
			if (!names.length) {
				return null;
			}
			const word = context.matchBefore(/[A-Za-z0-9_.\-/]*$/);
			return result(word ? word.from : context.pos, names.map((name) => ({
				label: name,
				detail: "Stored template",
				type: "text",
			})));
		}

		// Tag keyword position: `{%` then only an optional leading word.
		if (inStatement) {
			const tagMatch = region.match(/^\s*(\w*)$/);
			if (tagMatch) {
				const word = context.matchBefore(/\w*/);
				return result(word ? word.from : context.pos, TAGS);
			}
		}

		// Filter position: after a pipe.
		if (/\|\s*\w*$/.test(region)) {
			const word = context.matchBefore(/\w*/);
			return result(word ? word.from : context.pos, FILTERS);
		}

		// Test position: after `is` / `is not`.
		if (/\bis\s+(?:not\s+)?\w*$/.test(region)) {
			const word = context.matchBefore(/\w*/);
			return result(word ? word.from : context.pos, TESTS);
		}

		const parsed = parseChain(region);
		if (!parsed) {
			return null;
		}

		const word = context.matchBefore(/[A-Za-z0-9_]*$/);
		const from = word ? word.from : context.pos;

		// Root-level word (no resolved prefix): variables + functions + loop vars.
		if (parsed.segments.length === 0) {
			return result(from, rootCompletions(options, loopVars));
		}

		// Resolve the prefix path to a kind.
		const [first, ...restSegments] = parsed.segments;
		let kind = resolveRoot(first.name, options, loopVars);
		if (first.indexed && kind.type === "listObject") {
			// An indexed root list (e.g. items[0]) unwraps to its element object.
			kind = { type: "object" };
		}
		for (const segment of restSegments) {
			kind = step(kind, segment, options);
		}

		return result(from, completionsForKind(kind, options));
	};
}
