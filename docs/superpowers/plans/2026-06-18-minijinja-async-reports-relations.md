# MiniJinja + Async Reports + Relations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and correct the in-progress migration of the reports/templates frontend to MiniJinja templates, async task-based reports, and the new relations model — including a relation-aware template autocomplete and an `include.related_objects` report builder.

**Architecture:** Keep `@codemirror/lang-jinja` for parsing + syntax highlighting, but replace its completion with one custom, text-driven CodeMirror completion source (`src/lib/template-completion.ts`) that understands deep property paths, subscripts, loop-variable bindings, filters/helpers, and the relation alias domains. Async report flow and the include builder live in `reports-workspace.tsx` + `reporting.ts`.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, `@codemirror/*` (autocomplete, lang-jinja, view, state), `@tanstack/react-query`, Biome (lint), generated Orval client.

## Global Constraints

- No test runner exists. Per the approved spec, each task is verified by `npm run typecheck` (clean) and `npm run lint` (clean) plus the manual checks listed; do **not** add a test framework.
- Do **not** edit `openapi.json` or anything under `src/lib/api/generated/` (generated; source of truth as currently regenerated).
- Backend relation/report runtime rules (NOT in the OpenAPI schema — enforce client-side): include alias must match `^[A-Za-z_][A-Za-z0-9_]*$`; at most 8 include aliases; include `limit ∈ 1..50` (default 1); include `max_depth ∈ 1..10` (default 1); `relation_context.depth ∈ 1..2` (default 2).
- `include.related_objects` applies to `objects_in_class` only. `relation_context.depth` applies to `objects_in_class` (enables hydration) and `related_objects` (overrides default depth 2).
- Relation alias domains: `related.<alias>` uses relation/include aliases (include aliases are the only ones statically known); `reachable.<classAlias>` / `paths.<classAlias>` use class aliases (not statically known). Each alias resolves to a **list-of-object** (index `[n]` or loop to reach fields).
- Custom Hubuum helpers — filters: `csv_cell`, `tojson`, `default`, `length`, `sort`, `default_if_empty`, `format_datetime`, `join_nonempty`; function: `coalesce`; tests: `defined`, `none`, `string`, `sequence`.
- Reference: `docs/superpowers/specs/2026-06-18-minijinja-async-reports-relations-design.md`.
- Commit after each task. Branching is the user's call; commit on the current branch unless told otherwise.

## File Structure

- **Create** `src/lib/template-completion.ts` — the completion model (kinds + path resolver), helper/tag catalogs, and the `createTemplateCompletionSource(options)` CodeMirror source. One responsibility: produce template completions.
- **Modify** `src/lib/template-suggestions.ts` — reduce to the scope field model (`getScopeObjectFields`, `FieldDef`) + `analyzeTemplate`. Remove dead code.
- **Modify** `src/components/template-code-editor.tsx` — use the custom source; add `relationHydrated`/`relationAliases` props.
- **Modify** `src/components/reports-workspace.tsx` — help text, depth gating, error-state UX, include builder, pass relation props to editor.
- **Modify** `src/lib/api/reporting.ts` — typed error handling for 429 (submit) and 404/410 (output).
- **Modify** `src/app/globals.css` — delete orphaned `.cm-template-*` rules.

> **Refinement vs spec (apply during implementation):** the spec said to make `namespace_id`/`hubuum_class_id`/`data`/`path`/`path_objects` "universal for all scopes." The relation audit established this is too broad: object fields (`namespace_id`, `hubuum_class_id`, `data`) belong to object-bearing scopes (`objects_in_class`, `related_objects`) and hydrated relation entries; `path` is a related-entry field; `path_objects` exists only on `paths` entries — NOT a base item field. This plan implements that precise model. Universal base fields for every scope are only: `id`, `name`, `description`, `created_at`, `updated_at`.

---

### Task 1: Scope field model in `template-suggestions.ts`

Replace the suggestion-data internals with a clean, reusable field model the completion source consumes, while keeping `analyzeTemplate` (used by the editor footer). This task is additive + removal of now-unused helpers that have no other consumer yet; `getJinjaTags`/`getJinjaVariables`/`getJinjaProperties` are still imported by the editor, so they are removed in Task 4 (after the editor switches in Task 3).

**Files:**
- Modify: `src/lib/template-suggestions.ts`

**Interfaces:**
- Produces:
  - `type FieldDef = { name: string; detail: string; nested?: "namespace" }`
  - `function getScopeObjectFields(scopeKind?: ReportScopeKind): FieldDef[]` — base + scope-specific object fields (no relation maps, no `path_objects`).
  - `const NAMESPACE_FIELDS: FieldDef[]` — `id`, `name` (for `classes` `namespace.*`).
  - `function analyzeTemplate(value: string)` — unchanged signature/behaviour.

- [ ] **Step 1: Add the field model above the existing exports**

Insert near the top of `src/lib/template-suggestions.ts` (after the imports), keeping the existing `getJinjaTags`/`getJinjaVariables`/`getJinjaProperties` exports in place for now:

```ts
export type FieldDef = { name: string; detail: string; nested?: "namespace" };

const BASE_OBJECT_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Entity id" },
	{ name: "name", detail: "Entity name" },
	{ name: "description", detail: "Entity description" },
	{ name: "created_at", detail: "Creation timestamp" },
	{ name: "updated_at", detail: "Update timestamp" },
];

// Fields present on object-bearing items (real Hubuum objects) and on
// hydrated relation entries.
const OBJECT_ITEM_FIELDS: FieldDef[] = [
	{ name: "namespace_id", detail: "Namespace id" },
	{ name: "hubuum_class_id", detail: "Class id" },
	{ name: "data", detail: "JSON data blob" },
];

export const NAMESPACE_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Namespace id" },
	{ name: "name", detail: "Namespace name" },
];

const SCOPE_EXTRA_FIELDS: Partial<Record<ReportScopeKind, FieldDef[]>> = {
	classes: [
		{ name: "validate_schema", detail: "Whether this class validates object data" },
		{ name: "json_schema", detail: "JSON schema attached to this class" },
		{ name: "namespace", detail: "Owning namespace", nested: "namespace" },
	],
	objects_in_class: OBJECT_ITEM_FIELDS,
	class_relations: [
		{ name: "from_hubuum_class_id", detail: "Source class id" },
		{ name: "to_hubuum_class_id", detail: "Target class id" },
	],
	object_relations: [
		{ name: "class_relation_id", detail: "Class relation id" },
		{ name: "from_hubuum_object_id", detail: "Source object id" },
		{ name: "to_hubuum_object_id", detail: "Target object id" },
	],
	related_objects: [...OBJECT_ITEM_FIELDS, { name: "path", detail: "Traversal path (id list)" }],
};

export function getScopeObjectFields(scopeKind?: ReportScopeKind): FieldDef[] {
	if (!scopeKind) {
		return BASE_OBJECT_FIELDS;
	}
	const extras = SCOPE_EXTRA_FIELDS[scopeKind] ?? [];
	const seen = new Set<string>();
	return [...BASE_OBJECT_FIELDS, ...extras].filter((field) => {
		if (seen.has(field.name)) {
			return false;
		}
		seen.add(field.name);
		return true;
	});
}
```

- [ ] **Step 2: Verify typecheck still passes (old exports untouched)**

Run: `npm run typecheck`
Expected: PASS (additive change; existing exports unchanged).

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: PASS. If Biome flags an unused symbol, leave it — these are consumed in Task 2; only fix formatting issues it reports.

- [ ] **Step 4: Commit**

```bash
git add src/lib/template-suggestions.ts
git commit -m "Add scope object-field model for template completion"
```

---

### Task 2: Custom template completion source

Create the framework wiring + model resolver. Pure logic so it is reviewable; consumed by the editor in Task 3.

**Files:**
- Create: `src/lib/template-completion.ts`

**Interfaces:**
- Consumes: `getScopeObjectFields`, `NAMESPACE_FIELDS`, `FieldDef` from `@/lib/template-suggestions`; `ReportScopeKind` from `@/lib/api/reporting`.
- Produces:
  - `type TemplateCompletionOptions = { scopeKind?: ReportScopeKind; relationHydrated: boolean; relationAliases?: string[] }`
  - `function createTemplateCompletionSource(options: TemplateCompletionOptions): CompletionSource`

- [ ] **Step 1: Write the module**

Create `src/lib/template-completion.ts` with the full content below:

```ts
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
	| { type: "pathsEntry" } // an element of a paths.* group (object + path/path_objects)
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
	if (!match || !match[1]) {
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
		case "object": {
			if (segment.name === "related" && allowRelations("relatedMap")) {
				return { type: "relatedMap" };
			}
			if ((segment.name === "reachable" || segment.name === "paths") && allowRelations("classMap")) {
				return segment.name === "paths" ? { type: "classMap" } : { type: "classMap" };
			}
			// Track whether we came from a paths-group earlier? Simplify: paths
			// entries are produced by stepping classMap from a `paths` map; we
			// approximate by treating reachable/paths entries as plain objects.
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
		// classMap (reachable/paths) class aliases are not statically known.
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
		if (first.indexed) {
			kind = step({ type: "listObject" }, { name: first.name, indexed: true }, options);
		}
		for (const segment of restSegments) {
			kind = step(kind, segment, options);
		}

		return result(from, completionsForKind(kind, options));
	};
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. (Note the `range` function entry: `range` is standard Jinja; harmless to suggest. If TS flags the unused `restSegments` rename or similar, fix inline.)

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: PASS. Biome may suggest simplifying the `paths`/`reachable` ternary in `step` — replace `return segment.name === "paths" ? { type: "classMap" } : { type: "classMap" };` with `return { type: "classMap" };` if flagged.

- [ ] **Step 4: Manual reasoning check**

Confirm by reading the code that, with `scopeKind="objects_in_class"`, `relationHydrated=true`, `relationAliases=["rooms"]`:
- `{{ item.` → object fields + `related`/`reachable`/`paths` + `path_objects` (loop var `item` must be bound by an enclosing `{% for item in items %}`; if not, `item.` resolves to unknown — acceptable).
- `{{ item.related.` → `rooms`.
- `{{ item.related.rooms[0].` → object fields again.
- `{{ host.reachable.` (with `{% for host in items %}`) → empty (class aliases unknown).
- `{% e` → tag keywords.
- `{{ item.name | ` → filters.

- [ ] **Step 5: Commit**

```bash
git add src/lib/template-completion.ts
git commit -m "Add relation-aware template completion source"
```

---

### Task 3: Wire the custom source into the editor

Switch `template-code-editor.tsx` to use the custom completion source as the sole autocomplete override, keep `jinja()` for highlighting, and add the relation props.

**Files:**
- Modify: `src/components/template-code-editor.tsx`

**Interfaces:**
- Consumes: `createTemplateCompletionSource` from `@/lib/template-completion`; `analyzeTemplate` from `@/lib/template-suggestions`.
- Produces: `TemplateCodeEditor` now accepts `relationHydrated?: boolean` and `relationAliases?: string[]`.

- [ ] **Step 1: Replace imports and the props type**

Replace the top imports block (lines 1-29) so the editor uses the new source and no longer imports the removed suggestion helpers:

```tsx
"use client";

import {
	acceptCompletion,
	autocompletion,
} from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { closePercentBrace, jinja } from "@codemirror/lang-jinja";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { useMemo } from "react";

import { CodeEditor } from "@/components/code-editor";
import type { ReportScopeKind } from "@/lib/api/reporting";
import { createTemplateCompletionSource } from "@/lib/template-completion";
import { analyzeTemplate } from "@/lib/template-suggestions";

type TemplateCodeEditorProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	scopeKind?: ReportScopeKind;
	relationHydrated?: boolean;
	relationAliases?: string[];
};
```

- [ ] **Step 2: Update the component signature and extensions**

Replace the function signature (lines 31-38) and the `extensions` useMemo (lines 41-66) with:

```tsx
export function TemplateCodeEditor({
	label,
	value,
	onChange,
	placeholder,
	disabled,
	scopeKind,
	relationHydrated = false,
	relationAliases,
}: TemplateCodeEditorProps) {
	const analysis = useMemo(() => analyzeTemplate(value), [value]);

	const relationAliasesKey = (relationAliases ?? []).join(",");
	const extensions = useMemo<Extension[]>(
		() => [
			jinja(),
			closePercentBrace,
			keymap.of([
				{
					key: "Tab",
					run: (view) =>
						acceptCompletion(view) || Boolean(indentWithTab.run?.(view)),
				},
			]),
			autocompletion({
				activateOnTyping: true,
				closeOnBlur: true,
				selectOnOpen: true,
				maxRenderedOptions: 14,
				tooltipClass: () => "template-completion-tooltip",
				optionClass: () => "template-completion-option",
				override: [
					createTemplateCompletionSource({
						scopeKind,
						relationHydrated,
						relationAliases,
					}),
				],
			}),
		],
		// relationAliasesKey is a stable string proxy for the array identity.
		[scopeKind, relationHydrated, relationAliasesKey],
	);
```

Leave the rest of the component (balance message + JSX, lines 68-117) unchanged.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify lint**

Run: `npm run lint`
Expected: PASS. (If Biome warns about `relationAliasesKey` in deps, that is intentional — keep it; add a `// biome-ignore lint/correctness/useExhaustiveDependencies` only if lint fails the build.)

- [ ] **Step 5: Commit**

```bash
git add src/components/template-code-editor.tsx
git commit -m "Use custom completion source in template editor"
```

---

### Task 4: Remove dead code and orphaned CSS

Now that the editor no longer imports them, delete the unused suggestion exports and the orphaned highlighter CSS.

**Files:**
- Modify: `src/lib/template-suggestions.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Delete dead exports from `template-suggestions.ts`**

Remove these now-unused declarations entirely: `ROOT_TEMPLATE_SUGGESTIONS`, `LOOP_COMMON_SUGGESTIONS`, `RELATION_CONTEXT_SUGGESTIONS`, `MANUAL_SCOPE_EXTRAS`, `SCOPE_QUERY_FIELD_ALIASES`, `humanizeFieldName`, `mapScopeFieldToTemplatePath`, `dedupeSuggestions`, `getScopeSuggestions`, `toCompletion`, `propertyCompletion`, `stripPathPrefix`, `uniqueCompletions`, `getJinjaTags`, `getJinjaVariables`, `getJinjaProperties`, `getTemplateSuggestions`, `getValidTemplatePaths`, `validateTemplateExpression`, and the `TemplateSuggestionDefinition` type and the unused `Completion`/`SCOPE_QUERY_FIELDS` imports.

After removal the file should contain only: the `FieldDef`/field-model code added in Task 1 (which imports `ReportScopeKind`) and `analyzeTemplate`. Final file:

```ts
import type { ReportScopeKind } from "@/lib/api/reporting";

export type FieldDef = { name: string; detail: string; nested?: "namespace" };

const BASE_OBJECT_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Entity id" },
	{ name: "name", detail: "Entity name" },
	{ name: "description", detail: "Entity description" },
	{ name: "created_at", detail: "Creation timestamp" },
	{ name: "updated_at", detail: "Update timestamp" },
];

const OBJECT_ITEM_FIELDS: FieldDef[] = [
	{ name: "namespace_id", detail: "Namespace id" },
	{ name: "hubuum_class_id", detail: "Class id" },
	{ name: "data", detail: "JSON data blob" },
];

export const NAMESPACE_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Namespace id" },
	{ name: "name", detail: "Namespace name" },
];

const SCOPE_EXTRA_FIELDS: Partial<Record<ReportScopeKind, FieldDef[]>> = {
	classes: [
		{ name: "validate_schema", detail: "Whether this class validates object data" },
		{ name: "json_schema", detail: "JSON schema attached to this class" },
		{ name: "namespace", detail: "Owning namespace", nested: "namespace" },
	],
	objects_in_class: OBJECT_ITEM_FIELDS,
	class_relations: [
		{ name: "from_hubuum_class_id", detail: "Source class id" },
		{ name: "to_hubuum_class_id", detail: "Target class id" },
	],
	object_relations: [
		{ name: "class_relation_id", detail: "Class relation id" },
		{ name: "from_hubuum_object_id", detail: "Source object id" },
		{ name: "to_hubuum_object_id", detail: "Target object id" },
	],
	related_objects: [...OBJECT_ITEM_FIELDS, { name: "path", detail: "Traversal path (id list)" }],
};

export function getScopeObjectFields(scopeKind?: ReportScopeKind): FieldDef[] {
	if (!scopeKind) {
		return BASE_OBJECT_FIELDS;
	}
	const extras = SCOPE_EXTRA_FIELDS[scopeKind] ?? [];
	const seen = new Set<string>();
	return [...BASE_OBJECT_FIELDS, ...extras].filter((field) => {
		if (seen.has(field.name)) {
			return false;
		}
		seen.add(field.name);
		return true;
	});
}

export function analyzeTemplate(value: string) {
	const openEach = (value.match(/\{%\s*for\s+[^%]+%\}/g) ?? []).length;
	const closeEach = (value.match(/\{%\s*endfor\s*%\}/g) ?? []).length;
	const expressionMatches = value.match(/\{\{([^}]+)\}\}/g) ?? [];
	const expressions = Array.from(
		new Set(
			expressionMatches
				.map((match) => match.replaceAll("{", "").replaceAll("}", "").trim())
				.filter((match) => match !== "endfor" && !match.startsWith("for")),
		),
	);

	return {
		openEach,
		closeEach,
		expressions,
	};
}
```

- [ ] **Step 2: Delete the orphaned CSS block**

In `src/app/globals.css`, delete lines 2214-2237 (the six `.template-code-surface .cm-template-delimiter|keyword|path` rules, light + dark). Leave the `.cm-tooltip` rules at line 2239 and everything else intact.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. (If it fails with "X is not exported", a consumer was missed — grep `grep -rn "getJinjaProperties\|validateTemplateExpression\|getTemplateSuggestions" src` and remove/replace those usages.)

- [ ] **Step 4: Verify lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/template-suggestions.ts src/app/globals.css
git commit -m "Remove dead template-suggestion code and orphaned CSS"
```

---

### Task 5: Help text, placeholder, default template body

Fix the literal `\n`, and enrich the editor help and placeholder copy with MiniJinja realities.

**Files:**
- Modify: `src/components/reports-workspace.tsx`

- [ ] **Step 1: Update `TEMPLATE_HELP`**

Replace the `TEMPLATE_HELP` array (lines 87-93) with:

```tsx
const TEMPLATE_HELP = [
	"{{ item.name }} interpolates a value; {% for item in items %} ... {% endfor %} loops arrays.",
	"Root context: items, meta.*, warnings, request.*, and source (related_objects).",
	"Relations: item.related.<alias> (includes), item.reachable.*/paths.* (when hydrated) — each is a list, e.g. item.related.room[0].name.",
	"Helpers: coalesce(...), | tojson, | csv_cell, | default(...), | default_if_empty(...), | format_datetime(...), | join_nonempty(...).",
	"HTML templates are autoescaped; use | tojson or | csv_cell for sensitive values in text/CSV.",
	"include/import/extends resolve within the same namespace (e.g. layout.*, macros.*, partial.*, report.*).",
	"Stored templates support text/plain, text/html, and text/csv.",
] as const;
```

- [ ] **Step 2: Fix the default template body (real newline)**

Replace line 102 (`templateBody: "{% for item in items %}{{ item.name }}\n{% endfor %}",`) with a template literal containing a real newline:

```tsx
	templateBody: `{% for item in items %}{{ item.name }}
{% endfor %}`,
```

- [ ] **Step 3: Fix the editor placeholder (real newline)**

Replace the `placeholder="{% for item in items %}{{ item.name }}\n{% endfor %}"` attribute on `<TemplateCodeEditor>` (line 1578) with a brace expression template literal:

```tsx
							placeholder={`{% for item in items %}{{ item.name }}
{% endfor %}`}
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reports-workspace.tsx
git commit -m "Update template help, placeholder, and default body for MiniJinja"
```

---

### Task 6: Typed error handling in `reporting.ts`

Surface 429 on submit and 404/410 (expired/cleaned-up output) on fetch with specific messages.

**Files:**
- Modify: `src/lib/api/reporting.ts`

**Interfaces:**
- Produces: `submitReportTask` throws an `Error` with a 429-specific message; `fetchReportOutput` throws an `Error` whose message names expiry for 404/410.

- [ ] **Step 1: Add a 429 branch in `submitReportTask`**

Replace the status check in `submitReportTask` (lines 170-174) with:

```ts
	if (response.status === 429) {
		throw new Error(
			"Too many active report tasks. Wait for one to finish, then try again.",
		);
	}

	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to submit report."),
		);
	}
```

- [ ] **Step 2: Add 404/410 handling in `fetchReportOutput`**

Replace the `if (!response.ok) { ... }` block (lines 219-222) with:

```ts
	if (response.status === 404 || response.status === 410) {
		throw new Error(
			"This report output has expired or was cleaned up. Re-run the report to generate it again.",
		);
	}

	if (!response.ok) {
		const payload = await parseBody(response);
		throw new Error(getApiErrorMessage(payload, "Failed to fetch report output."));
	}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/reporting.ts
git commit -m "Surface 429 and expired-output errors in reporting client"
```

---

### Task 7: Report error-state UX and depth gating

Branch the result console on task status, show `output_expires_at`, and gate the relation depth control to the scopes where it applies with a 1..2 range.

**Files:**
- Modify: `src/components/reports-workspace.tsx`

- [ ] **Step 1: Add a helper to format the expiry and a derived terminal flag**

Right after `const reportDetails = activeReportTask?.details?.report ?? null;` (line 468), add:

```tsx
	const reportTerminal =
		activeReportTask != null && isTerminalTaskStatus(activeReportTask.status);
	const reportFailed =
		activeReportTask != null &&
		(activeReportTask.status === "failed" ||
			activeReportTask.status === "cancelled");
```

- [ ] **Step 2: Replace the neutral terminal empty-state with status-aware banners**

Replace the block at lines 1325-1332 (the `reportDetails?.output_available !== true && !lastResult` empty-state) with:

```tsx
						{reportFailed ? (
							<div className="error-banner">
								Report {activeReportTask?.status}.{" "}
								{activeReportTask?.summary?.trim()
									? activeReportTask.summary
									: "The task did not produce output."}
							</div>
						) : null}

						{reportTerminal &&
						!reportFailed &&
						reportDetails?.output_available !== true &&
						!lastResult ? (
							<div className="empty-state">
								No stored report output is available for this task.
							</div>
						) : null}
```

> If `TaskResponse` has no `summary` field, use the correct field for the failure message: check `src/lib/api/generated/models/taskResponse.ts`. If the field is named differently (e.g. `error`, `message`, `detail`), substitute it; if there is no such field, drop the `activeReportTask.summary` clause and keep the generic sentence.

- [ ] **Step 3: Show `output_expires_at` in the result meta**

In the `activeReportTask` preview-meta block, after the `reportDetails?.truncated` span (lines 1307-1313), add:

```tsx
								{reportDetails?.output_expires_at ? (
									<span>
										Output expires {formatTimestamp(reportDetails.output_expires_at)}
									</span>
								) : null}
```

- [ ] **Step 4: Gate and re-range the relation depth control**

Replace the "Relation hydration depth" control (lines 1230-1240) with a version shown only for the two applicable scopes and ranged 1..2:

```tsx
									{scopeKind === "objects_in_class" ||
									scopeKind === "related_objects" ? (
										<label className="control-field">
											<span>Relation hydration depth</span>
											<input
												type="number"
												min={1}
												max={2}
												value={relationDepth}
												onChange={(event) => setRelationDepth(event.target.value)}
												placeholder={
													scopeKind === "related_objects" ? "2 (default)" : "Off"
												}
											/>
										</label>
									) : null}
```

- [ ] **Step 5: Validate depth as 1..2 and only send for applicable scopes**

In `handleRunReport`, replace the relation-depth parsing/validation (lines 704-710) with:

```tsx
		const depthApplies =
			scopeKind === "objects_in_class" || scopeKind === "related_objects";
		let relationContext: ReportRequest["relation_context"] = null;
		if (depthApplies && relationDepth.trim()) {
			const parsedDepth = parsePositiveInteger(relationDepth);
			if (!parsedDepth || parsedDepth < 1 || parsedDepth > 2) {
				setRunnerError("Relation hydration depth must be 1 or 2.");
				return;
			}
			relationContext = { depth: parsedDepth };
		}
```

Then in the `runReportMutation.mutate({ body: { ... } })` call, replace the `relation_context: parsedRelationDepth ? { depth: parsedRelationDepth } : null,` line (lines 721-723) with:

```tsx
				relation_context: relationContext,
```

- [ ] **Step 6: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (If `summary` was wrong in Step 2, this is where typecheck catches it — fix per the note.)

- [ ] **Step 7: Manual reasoning check**

- A `failed`/`cancelled` task now renders a red banner (with summary if present) instead of the neutral "no output" message.
- The depth control disappears for `namespaces`/`classes`/`class_relations`/`object_relations` and is capped at 2.
- `output_expires_at`, when present, appears in the task meta row.

- [ ] **Step 8: Commit**

```bash
git add src/components/reports-workspace.tsx
git commit -m "Add report error-state UX and gate relation depth control"
```

---

### Task 8: `include.related_objects` builder

Add a builder (objects_in_class only) for related-object includes, wire it into the request, and feed its aliases to the template editor.

**Files:**
- Modify: `src/components/reports-workspace.tsx`

**Interfaces:**
- Consumes: `ReportInclude`, `ReportIncludeRelatedObject`, `ReportIncludeRelatedDirection`, `ReportIncludeRelatedSort` from generated models (via `@/lib/api/reporting` re-exports added below).
- Produces: `ReportRequest.include` populated when rows exist; `relationAliases` passed to `TemplateCodeEditor`.

- [ ] **Step 1: Re-export the include model types from `reporting.ts`**

In `src/lib/api/reporting.ts`, add to the `import type { ... } from "@/lib/api/generated/models"` list and the re-export block these names: `ReportInclude`, `ReportIncludeRelatedObject`, `ReportIncludeRelatedDirection`, `ReportIncludeRelatedSort`. The import becomes (insert the four names in alphabetical position):

```ts
import type {
	GetApiV1TemplatesParams,
	NewReportTemplate,
	ReportContentType,
	ReportInclude,
	ReportIncludeRelatedDirection,
	ReportIncludeRelatedObject,
	ReportIncludeRelatedSort,
	ReportJsonResponse,
	ReportMissingDataPolicy,
	ReportRequest,
	ReportScopeKind,
	ReportTemplate,
	TaskResponse,
	UpdateReportTemplate,
} from "@/lib/api/generated/models";
```

And add the same four names to the `export type { ... }` block below it.

- [ ] **Step 2: Add the include row type and constants in `reports-workspace.tsx`**

Add the import of the new types to the `from "@/lib/api/reporting"` block (alongside the existing `type ReportRequest` etc.):

```tsx
	type ReportInclude,
	type ReportIncludeRelatedDirection,
	type ReportIncludeRelatedObject,
	type ReportIncludeRelatedSort,
```

Then add near the other local types (after `QueryBuilderSort`, line 70):

```tsx
type IncludeBuilderRow = {
	id: string;
	alias: string;
	classId: string;
	direction: ReportIncludeRelatedDirection;
	sort: ReportIncludeRelatedSort;
	limit: string;
	maxDepth: string;
};

const INCLUDE_ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_INCLUDE_ALIASES = 8;
const INCLUDE_DIRECTIONS: ReportIncludeRelatedDirection[] = [
	"any",
	"outgoing",
	"incoming",
];
const INCLUDE_SORTS: ReportIncludeRelatedSort[] = ["path", "name", "created_at"];
```

- [ ] **Step 3: Add builder state**

After `const [builderSorts, setBuilderSorts] = useState<QueryBuilderSort[]>([]);` (line 411), add:

```tsx
	const [includeRows, setIncludeRows] = useState<IncludeBuilderRow[]>([]);
```

- [ ] **Step 4: Reset include rows when scope is not objects_in_class**

Extend the existing scope-cleanup `useEffect` (lines 519-529) by appending, inside the same effect body, a reset of include rows when the scope changes away from `objects_in_class`. Add this as a separate effect right after it:

```tsx
	useEffect(() => {
		if (scopeKind !== "objects_in_class") {
			setIncludeRows([]);
		}
	}, [scopeKind]);
```

- [ ] **Step 5: Add row helpers and the alias list memo**

After the `addSort` function (line 667), add:

```tsx
	function addIncludeRow() {
		setIncludeRows((current) => [
			...current,
			{
				id: createBuilderId(),
				alias: "",
				classId: "",
				direction: "any",
				sort: "path",
				limit: "",
				maxDepth: "",
			},
		]);
	}

	function updateIncludeRow(id: string, patch: Partial<IncludeBuilderRow>) {
		setIncludeRows((current) =>
			current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
		);
	}

	function removeIncludeRow(id: string) {
		setIncludeRows((current) => current.filter((row) => row.id !== id));
	}
```

And near the other `useMemo`s (after `builtQuery`, line 462), add the alias list used for both validation and editor completion:

```tsx
	const includeAliases = useMemo(
		() =>
			includeRows
				.map((row) => row.alias.trim())
				.filter((alias) => INCLUDE_ALIAS_PATTERN.test(alias)),
		[includeRows],
	);
```

- [ ] **Step 6: Build and validate the include map in `handleRunReport`**

Immediately before the `setRunnerError(null);` line near the end of `handleRunReport` (line 712), add validation + assembly:

```tsx
		let include: ReportInclude | null = null;
		if (scopeKind === "objects_in_class" && includeRows.length) {
			if (includeRows.length > MAX_INCLUDE_ALIASES) {
				setRunnerError(`At most ${MAX_INCLUDE_ALIASES} related includes are allowed.`);
				return;
			}
			const relatedObjects: Record<string, ReportIncludeRelatedObject> = {};
			for (const row of includeRows) {
				const alias = row.alias.trim();
				if (!INCLUDE_ALIAS_PATTERN.test(alias)) {
					setRunnerError(
						`Include alias "${alias || "(empty)"}" must match [A-Za-z_][A-Za-z0-9_]*.`,
					);
					return;
				}
				if (relatedObjects[alias]) {
					setRunnerError(`Duplicate include alias "${alias}".`);
					return;
				}
				const includeClassId = parsePositiveInteger(row.classId);
				if (!includeClassId) {
					setRunnerError(`Include "${alias}" needs a class.`);
					return;
				}
				const entry: ReportIncludeRelatedObject = {
					class_id: includeClassId,
					direction: row.direction,
					sort: row.sort,
				};
				if (row.limit.trim()) {
					const limit = parsePositiveInteger(row.limit);
					if (!limit || limit > 50) {
						setRunnerError(`Include "${alias}" limit must be 1..50.`);
						return;
					}
					entry.limit = limit;
				}
				if (row.maxDepth.trim()) {
					const maxDepth = parsePositiveInteger(row.maxDepth);
					if (!maxDepth || maxDepth > 10) {
						setRunnerError(`Include "${alias}" max depth must be 1..10.`);
						return;
					}
					entry.max_depth = maxDepth;
				}
				relatedObjects[alias] = entry;
			}
			include = { related_objects: relatedObjects };
		}
```

Then add `include,` to the `runReportMutation.mutate({ body: { ... } })` object (right after `scope,` on line 718):

```tsx
				scope,
				include,
```

- [ ] **Step 7: Render the include builder (objects_in_class only)**

Insert this block in the runner form, immediately after the closing `</div>` of the `query-builder-card` (after line 1212, before the "Missing data policy" label):

```tsx
								{scopeKind === "objects_in_class" ? (
									<div className="query-builder-card control-field--wide">
										<div className="panel-header">
											<div className="stack action-card-header">
												<h4>Related includes</h4>
												<p className="muted">
													Hydrate related objects under item.related.&lt;alias&gt;
													(up to {MAX_INCLUDE_ALIASES}). Each alias is a list.
												</p>
											</div>
											<div className="action-row">
												<button
													type="button"
													className="ghost"
													onClick={addIncludeRow}
													disabled={includeRows.length >= MAX_INCLUDE_ALIASES}
												>
													Add include
												</button>
											</div>
										</div>

										{includeRows.length ? (
											<div className="stack">
												{includeRows.map((row) => (
													<div key={row.id} className="query-row">
														<input
															value={row.alias}
															onChange={(event) =>
																updateIncludeRow(row.id, { alias: event.target.value })
															}
															placeholder="alias (e.g. rooms)"
														/>
														{classOptions.length > 0 ? (
															<select
																value={row.classId}
																onChange={(event) =>
																	updateIncludeRow(row.id, {
																		classId: event.target.value,
																	})
																}
															>
																<option value="">Select class</option>
																{classOptions.map((classItem) => (
																	<option key={classItem.id} value={classItem.id}>
																		{classItem.name} (#{classItem.id})
																	</option>
																))}
															</select>
														) : (
															<input
																type="number"
																min={1}
																value={row.classId}
																onChange={(event) =>
																	updateIncludeRow(row.id, {
																		classId: event.target.value,
																	})
																}
																placeholder="class ID"
															/>
														)}
														<select
															value={row.direction}
															onChange={(event) =>
																updateIncludeRow(row.id, {
																	direction: event.target
																		.value as ReportIncludeRelatedDirection,
																})
															}
														>
															{INCLUDE_DIRECTIONS.map((direction) => (
																<option key={direction} value={direction}>
																	{direction}
																</option>
															))}
														</select>
														<select
															value={row.sort}
															onChange={(event) =>
																updateIncludeRow(row.id, {
																	sort: event.target
																		.value as ReportIncludeRelatedSort,
																})
															}
														>
															{INCLUDE_SORTS.map((sort) => (
																<option key={sort} value={sort}>
																	{sort}
																</option>
															))}
														</select>
														<input
															type="number"
															min={1}
															max={50}
															value={row.limit}
															onChange={(event) =>
																updateIncludeRow(row.id, { limit: event.target.value })
															}
															placeholder="limit 1..50"
														/>
														<input
															type="number"
															min={1}
															max={10}
															value={row.maxDepth}
															onChange={(event) =>
																updateIncludeRow(row.id, {
																	maxDepth: event.target.value,
																})
															}
															placeholder="depth 1..10"
														/>
														<button
															type="button"
															className="ghost"
															onClick={() => removeIncludeRow(row.id)}
														>
															Remove
														</button>
													</div>
												))}
											</div>
										) : (
											<div className="empty-state">
												No related includes. Add one to hydrate item.related.&lt;alias&gt;.
											</div>
										)}
									</div>
								) : null}
```

- [ ] **Step 8: Pass relation props to the template editor**

Replace the `<TemplateCodeEditor ... scopeKind={scopeKind} />` usage (lines 1572-1581) so it also passes hydration + aliases:

```tsx
							<TemplateCodeEditor
								label="Template body"
								value={editorState.templateBody}
								onChange={(templateBody) =>
									setEditorState({ ...editorState, templateBody })
								}
								placeholder={`{% for item in items %}{{ item.name }}
{% endfor %}`}
								disabled={saveTemplateMutation.isPending}
								scopeKind={scopeKind}
								relationHydrated={
									scopeKind === "related_objects" ||
									(scopeKind === "objects_in_class" && relationDepth.trim() !== "")
								}
								relationAliases={includeAliases}
							/>
```

- [ ] **Step 9: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 10: Manual reasoning check**

- The "Related includes" section appears only for `objects_in_class`.
- Adding rows and running builds `include.related_objects = { <alias>: { class_id, direction, sort, limit?, max_depth? } }`; invalid alias/limit/depth/class are rejected with specific messages; >8 rows rejected.
- In the template editor (with the include alias `rooms` configured), typing `{{ item.related.` offers `rooms`.

- [ ] **Step 11: Commit**

```bash
git add src/lib/api/reporting.ts src/components/reports-workspace.tsx
git commit -m "Add include.related_objects report builder and editor aliases"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Production build smoke test**

Run: `npm run build`
Expected: Build completes without type/compile errors. (If the environment cannot build, note it and rely on typecheck.)

- [ ] **Step 4: Manual verification checklist (record results)**

Against the running app (`npm run dev`) or by reasoning if no backend is available:
- Template editor: tag completion after `{%`; filter completion after `|`; `item.` fields; `item.related.<alias>` after configuring an include; subscript navigation `item.related.<alias>[0].name`; `source.*` only for `related_objects`; `reachable`/`paths` only when depth set.
- Reports: submit → poll → output; failed task shows red banner; `output_expires_at` shown; depth control only for objects_in_class/related_objects and capped at 2; include builder only for objects_in_class.
- Note in the PR/commit which checks were verified live vs. by reasoning (no backend / no test runner).

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "Finalize MiniJinja + async reports + relations migration"
```

---

## Self-Review

**Spec coverage:**
- A (autocomplete correctness): Tasks 1, 2, 4 (field model, helpers/filters/tests, dead-code removal), Task 5 (help/placeholder). ✓
- B (relations expansion + coloring): Task 2 (resolver, alias domains, subscripts, loop vars), Task 3 (wiring), Task 4 (orphaned CSS; coloring relies on lang-jinja grammar — unchanged). ✓
- C (async error UX): Task 6 (429/404/410), Task 7 (status banners, expiry, depth gating 1..2 incl. related_objects). ✓
- D (include builder): Task 8 (types, state, validation, UI, wiring, editor aliases). ✓
- Non-goals (graph viz, streaming search, idempotency-key, class-level relations): not included. ✓

**Placeholder scan:** No TBD/TODO. One conditional note (Step 2 of Task 7) about the `TaskResponse` failure-message field — resolved by inspecting the generated model during that step (instruction given), not a placeholder in the deliverable.

**Type consistency:** `createTemplateCompletionSource(options)` / `TemplateCompletionOptions` consistent across Tasks 2-3. `getScopeObjectFields`/`FieldDef`/`NAMESPACE_FIELDS` consistent Tasks 1-2-4. `IncludeBuilderRow` and `ReportIncludeRelatedObject` field names (`class_id`, `direction`, `sort`, `limit`, `max_depth`) match the generated model read earlier. `relationHydrated`/`relationAliases` prop names consistent Tasks 3 and 8.

**Known refinement flagged:** universal-fields precision deviates from the spec's blanket wording (documented at top of plan); confirm acceptable at execution.
