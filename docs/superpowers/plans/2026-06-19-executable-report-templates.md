# Executable Report Templates (PR #55 adaptation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the reports/templates frontend to hubuum PR #55: regenerate the client from the new contract, make stored templates self-describing/executable, run them via the new dedicated endpoint, and give the runner two explicit modes.

**Architecture:** Regenerate the Orval client from PR #55's `openapi.json`. Split report submission into `submitJsonReportTask` (POST /reports) and `runTemplateReport` (POST /templates/{id}/reports). Extract the related-object include builder into a shared module + component reused by both the template editor and the JSON runner. The template create/edit form gains scope/class/default-query/include/relation/defaults (kind: report|fragment); the runner becomes two tabs (JSON report / run template).

**Tech Stack:** Next.js 16, React 19, TypeScript 6, `@codemirror/*`, `@tanstack/react-query`, Biome, Orval (`npm run gen:api`).

## Global Constraints

- No unit-test runner. Gates per task: `npm run typecheck` and `npm run lint`; final task also `npm run build`. Do not add a test framework.
- **Breaking regeneration:** Tasks 1–4 leave `npm run typecheck` RED (the API change removes `output.template_id`/`ReportOutputRequest`); green is restored at Task 5. Each RED task's gate is its own stated check (gen:api success / `tsc` showing only the expected cross-file errors), not full green. This is explicit and expected.
- Do not hand-edit anything under `src/lib/api/generated/` — it is produced by `npm run gen:api`.
- Source of truth = PR #55 branch `clean-executable-report-templates`. A copy of its `openapi.json` is cached at `/tmp/hubuum55-openapi.json` (≈280 KB); if absent, re-download from `https://raw.githubusercontent.com/hubuum/hubuum/clean-executable-report-templates/docs/openapi.json`.
- Verified #55 contract:
  - New op `postApiV1TemplatesByTemplateIdReports(templateId, body)` → 202 + `TaskResponse`; body `ReportTemplateRunRequest = { query?: string|null; object_id?: number|null; limits?: ReportLimits|null; missing_data_policy?: ReportMissingDataPolicy|null }`.
  - `postApiV1Reports(body)` body `ReportRequest = { scope*; query?; include?; relation_context?; limits?; missing_data_policy? }` — **no `output`**.
  - `ReportTemplate`/`NewReportTemplate` add: `kind*: ReportTemplateKind('report'|'fragment')`, `scope_kind?: ReportScopeKind|null`, `class_id?: number|null`, `default_query?: string|null`, `include?: ReportInclude|null`, `relation_context?: ReportRelationContext|null`, `default_missing_data_policy?: ReportMissingDataPolicy|null`, `default_limits?: ReportLimits|null`. `UpdateReportTemplate` = all writable fields optional/nullable. `ReportOutputRequest` removed.
  - `ReportInclude.related_objects = { [alias]: ReportIncludeRelatedObject } | null`; `ReportIncludeRelatedObject = { class_id*; class_relation_id?; direction?: 'any'|'outgoing'|'incoming'; limit?; max_depth?; sort?: 'path'|'name'|'created_at' }`.
- Client-side runtime rules: content_type ∈ text/plain|html|csv; include alias `^[A-Za-z_][A-Za-z0-9_]*$`, ≤8, limit 1..50, max_depth 1..10; relation depth 1..2; `related_objects` run requires `object_id`.
- No run-time `relation_context` override (not in `ReportTemplateRunRequest`).
- Spec: `docs/superpowers/specs/2026-06-19-executable-report-templates-design.md`.
- Commit after each task. Stay on branch `feat/minijinja-async-reports`.

## File Structure

- **Modify** `openapi.json` + regenerate `src/lib/api/generated/**` (Task 1).
- **Modify** `src/lib/api/reporting.ts` — split submission, new re-exports (Task 2).
- **Create** `src/lib/report-include.ts` — include row type, constants, `buildIncludeFromRows`, `includeAliasesOf`, `includeRowsFromTemplate` (Task 3).
- **Create** `src/components/include-rows.tsx` — presentational include-row editor reused by template form + JSON runner (Task 3).
- **Modify** `src/components/reports-workspace.tsx` — template editor form (Task 4), two-tab runner (Task 5). (Large; kept in place. Result console + template library list JSX unchanged.)
- **Modify** `src/lib/template-completion.ts` + `src/components/template-code-editor.tsx` — include/import/extends name completion (Task 6).

---

### Task 1: Regenerate the API client from PR #55

**Files:**
- Modify: `openapi.json`
- Regenerate: `src/lib/api/generated/**`

- [ ] **Step 1: Replace the spec with PR #55's**

```bash
cp /tmp/hubuum55-openapi.json openapi.json 2>/dev/null || curl -fsSL https://raw.githubusercontent.com/hubuum/hubuum/clean-executable-report-templates/docs/openapi.json -o openapi.json
```

- [ ] **Step 2: Regenerate**

Run: `npm run gen:api`
Expected: orval completes and the prefix patch runs without error.

- [ ] **Step 3: Verify the new symbols exist and the old one is gone**

```bash
grep -rl "postApiV1TemplatesByTemplateIdReports" src/lib/api/generated/client.ts
test -f src/lib/api/generated/models/reportTemplateRunRequest.ts && echo "run-request model OK"
test -f src/lib/api/generated/models/reportTemplateKind.ts && echo "kind model OK"
grep -q "kind" src/lib/api/generated/models/reportTemplate.ts && echo "template.kind OK"
test ! -f src/lib/api/generated/models/reportOutputRequest.ts && echo "ReportOutputRequest removed OK"
```
Expected: all four lines print. If `reportOutputRequest.ts` still exists, the spec swap didn't take — re-check Step 1.

- [ ] **Step 4: Commit (typecheck intentionally RED — do not run it as a gate here)**

```bash
git add openapi.json src/lib/api/generated
git commit -m "Regenerate API client from hubuum PR #55 (executable templates)"
```

Note: `npm run typecheck` will fail after this commit (consumers reference the removed `output`/`ReportOutputRequest`). That is expected and fixed by Tasks 2–5.

---

### Task 2: Split report submission in `reporting.ts`

**Files:**
- Modify: `src/lib/api/reporting.ts`

**Interfaces:**
- Produces:
  - `submitJsonReportTask(request: ReportRequest, idempotencyKey?: string): Promise<TaskResponse>`
  - `runTemplateReport(templateId: number, overrides: ReportTemplateRunRequest, idempotencyKey?: string): Promise<TaskResponse>`
  - Re-exports add `ReportTemplateKind`, `ReportTemplateRunRequest`, `ReportRelationContext`, `ReportLimits`.

- [ ] **Step 1: Update imports + re-exports**

In `src/lib/api/reporting.ts`, replace the generated-client import block (lines 2–9) to add the new endpoint:

```ts
import {
	deleteApiV1TemplatesByTemplateId,
	getApiV1ReportsByTaskId,
	getApiV1Templates,
	patchApiV1TemplatesByTemplateId,
	postApiV1Reports,
	postApiV1Templates,
	postApiV1TemplatesByTemplateIdReports,
} from "@/lib/api/generated/client";
```

Add to the `import type { … }` block (alphabetically) these names: `ReportLimits`, `ReportRelationContext`, `ReportTemplateKind`, `ReportTemplateRunRequest`. Add the same four to the `export type { … }` block.

- [ ] **Step 2: Replace `submitReportTask` with the two submitters**

Replace the entire `submitReportTask` function (current lines 163–191) with:

```ts
export async function submitJsonReportTask(
	request: ReportRequest,
	idempotencyKey?: string,
): Promise<TaskResponse> {
	const headers = new Headers();
	if (idempotencyKey?.trim()) {
		headers.set("Idempotency-Key", idempotencyKey.trim());
	}

	const response = await postApiV1Reports(request, {
		credentials: "include",
		headers,
	});

	if ((response.status as number) === 429) {
		throw new Error(
			"Too many active report tasks. Wait for one to finish, then try again.",
		);
	}
	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to submit report."),
		);
	}
	return response.data;
}

export async function runTemplateReport(
	templateId: number,
	overrides: ReportTemplateRunRequest,
	idempotencyKey?: string,
): Promise<TaskResponse> {
	const headers = new Headers();
	if (idempotencyKey?.trim()) {
		headers.set("Idempotency-Key", idempotencyKey.trim());
	}

	const response = await postApiV1TemplatesByTemplateIdReports(
		templateId,
		overrides,
		{ credentials: "include", headers },
	);

	if ((response.status as number) === 429) {
		throw new Error(
			"Too many active report tasks. Wait for one to finish, then try again.",
		);
	}
	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to run template report."),
		);
	}
	return response.data;
}
```

- [ ] **Step 3: Targeted check on reporting.ts**

Run: `npx tsc --noEmit src/lib/api/reporting.ts 2>&1 | grep "reporting.ts" || echo "reporting.ts: no own-file type errors"`
Expected: `reporting.ts: no own-file type errors` (full `npm run typecheck` is still RED due to consumers — that's fine).

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/reporting.ts
git commit -m "Split report submission into JSON and template-run helpers"
```

---

### Task 3: Extract shared include builder

**Files:**
- Create: `src/lib/report-include.ts`
- Create: `src/components/include-rows.tsx`

**Interfaces:**
- Produces (`report-include.ts`):
  - `type IncludeBuilderRow = { id: string; alias: string; classId: string; direction: ReportIncludeRelatedDirection; sort: ReportIncludeRelatedSort; limit: string; maxDepth: string }`
  - `const INCLUDE_ALIAS_PATTERN`, `MAX_INCLUDE_ALIASES`, `INCLUDE_DIRECTIONS`, `INCLUDE_SORTS`
  - `function newIncludeRow(id: string): IncludeBuilderRow`
  - `function includeAliasesOf(rows: IncludeBuilderRow[]): string[]`
  - `function includeRowsFromTemplate(include: ReportInclude | null | undefined, makeId: () => string): IncludeBuilderRow[]`
  - `function buildIncludeFromRows(rows: IncludeBuilderRow[]): { include: ReportInclude | null } | { error: string }`
- Produces (`include-rows.tsx`): `function IncludeRows(props: { rows: IncludeBuilderRow[]; classOptions: { id: number; name: string }[]; onAdd: () => void; onUpdate: (id: string, patch: Partial<IncludeBuilderRow>) => void; onRemove: (id: string) => void }): JSX.Element`

- [ ] **Step 1: Create `src/lib/report-include.ts`**

```ts
import type {
	ReportInclude,
	ReportIncludeRelatedDirection,
	ReportIncludeRelatedObject,
	ReportIncludeRelatedSort,
} from "@/lib/api/reporting";

export type IncludeBuilderRow = {
	id: string;
	alias: string;
	classId: string;
	direction: ReportIncludeRelatedDirection;
	sort: ReportIncludeRelatedSort;
	limit: string;
	maxDepth: string;
};

export const INCLUDE_ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_INCLUDE_ALIASES = 8;
export const INCLUDE_DIRECTIONS: ReportIncludeRelatedDirection[] = [
	"any",
	"outgoing",
	"incoming",
];
export const INCLUDE_SORTS: ReportIncludeRelatedSort[] = [
	"path",
	"name",
	"created_at",
];

export function newIncludeRow(id: string): IncludeBuilderRow {
	return {
		id,
		alias: "",
		classId: "",
		direction: "any",
		sort: "path",
		limit: "",
		maxDepth: "",
	};
}

export function includeAliasesOf(rows: IncludeBuilderRow[]): string[] {
	return rows
		.map((row) => row.alias.trim())
		.filter((alias) => INCLUDE_ALIAS_PATTERN.test(alias));
}

export function includeRowsFromTemplate(
	include: ReportInclude | null | undefined,
	makeId: () => string,
): IncludeBuilderRow[] {
	const related = include?.related_objects;
	if (!related) {
		return [];
	}
	return Object.entries(related).map(([alias, entry]) => ({
		id: makeId(),
		alias,
		classId: String(entry.class_id),
		direction: entry.direction ?? "any",
		sort: entry.sort ?? "path",
		limit: entry.limit != null ? String(entry.limit) : "",
		maxDepth: entry.max_depth != null ? String(entry.max_depth) : "",
	}));
}

function parsePositive(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildIncludeFromRows(
	rows: IncludeBuilderRow[],
): { include: ReportInclude | null } | { error: string } {
	if (!rows.length) {
		return { include: null };
	}
	if (rows.length > MAX_INCLUDE_ALIASES) {
		return { error: `At most ${MAX_INCLUDE_ALIASES} related includes are allowed.` };
	}
	const relatedObjects: Record<string, ReportIncludeRelatedObject> = {};
	for (const row of rows) {
		const alias = row.alias.trim();
		if (!INCLUDE_ALIAS_PATTERN.test(alias)) {
			return {
				error: `Include alias "${alias || "(empty)"}" must match [A-Za-z_][A-Za-z0-9_]*.`,
			};
		}
		if (relatedObjects[alias]) {
			return { error: `Duplicate include alias "${alias}".` };
		}
		const includeClassId = parsePositive(row.classId);
		if (!includeClassId) {
			return { error: `Include "${alias}" needs a class.` };
		}
		const entry: ReportIncludeRelatedObject = {
			class_id: includeClassId,
			direction: row.direction,
			sort: row.sort,
		};
		if (row.limit.trim()) {
			const limit = parsePositive(row.limit);
			if (!limit || limit > 50) {
				return { error: `Include "${alias}" limit must be 1..50.` };
			}
			entry.limit = limit;
		}
		if (row.maxDepth.trim()) {
			const maxDepth = parsePositive(row.maxDepth);
			if (!maxDepth || maxDepth > 10) {
				return { error: `Include "${alias}" max depth must be 1..10.` };
			}
			entry.max_depth = maxDepth;
		}
		relatedObjects[alias] = entry;
	}
	return { include: { related_objects: relatedObjects } };
}
```

- [ ] **Step 2: Create `src/components/include-rows.tsx`**

```tsx
"use client";

import {
	INCLUDE_DIRECTIONS,
	INCLUDE_SORTS,
	type IncludeBuilderRow,
} from "@/lib/report-include";
import type {
	ReportIncludeRelatedDirection,
	ReportIncludeRelatedSort,
} from "@/lib/api/reporting";

type IncludeRowsProps = {
	rows: IncludeBuilderRow[];
	classOptions: { id: number; name: string }[];
	onAdd: () => void;
	onUpdate: (id: string, patch: Partial<IncludeBuilderRow>) => void;
	onRemove: (id: string) => void;
};

export function IncludeRows({
	rows,
	classOptions,
	onAdd,
	onUpdate,
	onRemove,
}: IncludeRowsProps) {
	return (
		<div className="query-builder-card control-field--wide">
			<div className="panel-header">
				<div className="stack action-card-header">
					<h4>Related includes</h4>
					<p className="muted">
						Hydrate related objects under item.related.&lt;alias&gt; (up to 8).
						Each alias is a list.
					</p>
				</div>
				<div className="action-row">
					<button
						type="button"
						className="ghost"
						onClick={onAdd}
						disabled={rows.length >= 8}
					>
						Add include
					</button>
				</div>
			</div>

			{rows.length ? (
				<div className="stack">
					{rows.map((row) => (
						<div key={row.id} className="query-row">
							<input
								value={row.alias}
								onChange={(event) => onUpdate(row.id, { alias: event.target.value })}
								placeholder="alias (e.g. rooms)"
							/>
							{classOptions.length > 0 ? (
								<select
									value={row.classId}
									onChange={(event) => onUpdate(row.id, { classId: event.target.value })}
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
									onChange={(event) => onUpdate(row.id, { classId: event.target.value })}
									placeholder="class ID"
								/>
							)}
							<select
								value={row.direction}
								onChange={(event) =>
									onUpdate(row.id, {
										direction: event.target.value as ReportIncludeRelatedDirection,
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
									onUpdate(row.id, {
										sort: event.target.value as ReportIncludeRelatedSort,
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
								onChange={(event) => onUpdate(row.id, { limit: event.target.value })}
								placeholder="limit 1..50"
							/>
							<input
								type="number"
								min={1}
								max={10}
								value={row.maxDepth}
								onChange={(event) => onUpdate(row.id, { maxDepth: event.target.value })}
								placeholder="depth 1..10"
							/>
							<button type="button" className="ghost" onClick={() => onRemove(row.id)}>
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
	);
}
```

- [ ] **Step 3: Verify the new files typecheck in isolation**

Run: `npx tsc --noEmit src/lib/report-include.ts src/components/include-rows.tsx 2>&1 | grep -E "report-include|include-rows" || echo "new files: no own-file errors"`
Expected: `new files: no own-file errors`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/report-include.ts src/components/include-rows.tsx
git commit -m "Extract shared related-include builder module and component"
```

---

### Task 4: Template editor form gains executable-template fields

**Files:**
- Modify: `src/components/reports-workspace.tsx`

This rewrites `TemplateEditorState`, `DEFAULT_TEMPLATE_EDITOR`, `buildTemplateEditorState`, the save mutation's assembly/validation, the editor modal JSX, and the `<TemplateCodeEditor>` props. Still RED until Task 5 (runner consumers).

**Interfaces:**
- Consumes: `report-include.ts` helpers + `IncludeRows`; `ReportTemplateKind`, `NewReportTemplate`, `UpdateReportTemplate`, `ReportScopeKind` from reporting.
- Produces: the editor form persists all new template fields.

- [ ] **Step 1: Imports**

Add to the top imports of `reports-workspace.tsx`:

```tsx
import { IncludeRows } from "@/components/include-rows";
import {
	buildIncludeFromRows,
	includeAliasesOf,
	includeRowsFromTemplate,
	type IncludeBuilderRow,
	newIncludeRow,
} from "@/lib/report-include";
```

In the `from "@/lib/api/reporting"` import block, add `type ReportTemplateKind,` and `runTemplateReport,` and `submitJsonReportTask,`; remove `submitReportTask,`. (The two new submitters are used in Task 5; importing now is fine.) Remove the now-unused local `IncludeBuilderRow` type, `INCLUDE_ALIAS_PATTERN`, `MAX_INCLUDE_ALIASES`, `INCLUDE_DIRECTIONS`, `INCLUDE_SORTS` declarations (lines 76–93) and the `ReportIncludeRelated*` type imports that only they used — they now live in `report-include.ts`. Keep `ReportInclude`/`ReportIncludeRelatedObject` imports only if still referenced; otherwise remove.

- [ ] **Step 2: Replace `TemplateEditorState` and `DEFAULT_TEMPLATE_EDITOR`**

Replace the `TemplateEditorState` type (lines 53–61) and `DEFAULT_TEMPLATE_EDITOR` (lines 120–129) with:

```tsx
type TemplateEditorState = {
	mode: "create" | "edit";
	templateId: number | null;
	namespaceId: string;
	name: string;
	description: string;
	contentType: StoredReportContentType;
	templateBody: string;
	kind: ReportTemplateKind;
	scopeKind: ReportScopeKind;
	classId: string;
	defaultQuery: string;
	includeRows: IncludeBuilderRow[];
	depth: string;
	missingDataPolicy: ReportMissingDataPolicy;
	maxItems: string;
	maxOutputBytes: string;
};
```

```tsx
const DEFAULT_TEMPLATE_EDITOR: TemplateEditorState = {
	mode: "create",
	templateId: null,
	namespaceId: "",
	name: "",
	description: "",
	contentType: "text/plain",
	templateBody: `{% for item in items %}{{ item.name }}
{% endfor %}`,
	kind: "report",
	scopeKind: "objects_in_class",
	classId: "",
	defaultQuery: "",
	includeRows: [],
	depth: "",
	missingDataPolicy: "strict",
	maxItems: "",
	maxOutputBytes: "",
};
```

- [ ] **Step 3: Replace `buildTemplateEditorState`**

Replace it (lines 207–226) with a version that hydrates the new fields:

```tsx
function buildTemplateEditorState(
	template?: ReportTemplate | null,
): TemplateEditorState {
	if (!template) {
		return DEFAULT_TEMPLATE_EDITOR;
	}

	return {
		mode: "edit",
		templateId: template.id,
		namespaceId: String(template.namespace_id),
		name: template.name,
		description: template.description,
		contentType:
			template.content_type === "application/json"
				? "text/plain"
				: template.content_type,
		templateBody: template.template,
		kind: template.kind,
		scopeKind: template.scope_kind ?? "objects_in_class",
		classId: template.class_id != null ? String(template.class_id) : "",
		defaultQuery: template.default_query ?? "",
		includeRows: includeRowsFromTemplate(template.include, createBuilderId),
		depth:
			template.relation_context?.depth != null
				? String(template.relation_context.depth)
				: "",
		missingDataPolicy: template.default_missing_data_policy ?? "strict",
		maxItems:
			template.default_limits?.max_items != null
				? String(template.default_limits.max_items)
				: "",
		maxOutputBytes:
			template.default_limits?.max_output_bytes != null
				? String(template.default_limits.max_output_bytes)
				: "",
	};
}
```

- [ ] **Step 4: Replace the save mutation `mutationFn` body**

Replace the `mutationFn` of `saveTemplateMutation` (lines 579–616) with one that validates and assembles the new fields. Note: this returns a shared assembled-payload object used for both create and update.

```tsx
		mutationFn: async (draft: TemplateEditorState) => {
			const namespaceId = parsePositiveInteger(draft.namespaceId);
			if (!namespaceId) throw new Error("Namespace is required.");
			if (!draft.name.trim()) throw new Error("Name is required.");
			if (!draft.description.trim()) throw new Error("Description is required.");
			if (!draft.templateBody.trim()) throw new Error("Template body is required.");

			const base = {
				namespace_id: namespaceId,
				name: draft.name.trim(),
				description: draft.description.trim(),
				content_type: draft.contentType,
				template: draft.templateBody,
				kind: draft.kind,
			};

			let reportFields: Partial<NewReportTemplate> = {};
			if (draft.kind === "report") {
				const scopeNeedsClass =
					draft.scopeKind === "objects_in_class" ||
					draft.scopeKind === "related_objects";
				const classId = parsePositiveInteger(draft.classId);
				if (scopeNeedsClass && !classId) {
					throw new Error("Class is required for the selected scope.");
				}
				let include = null;
				if (draft.scopeKind === "objects_in_class") {
					const built = buildIncludeFromRows(draft.includeRows);
					if ("error" in built) throw new Error(built.error);
					include = built.include;
				}
				let relationContext = null;
				if (draft.depth.trim()) {
					const depth = parsePositiveInteger(draft.depth);
					if (!depth || depth < 1 || depth > 2) {
						throw new Error("Relation depth must be 1 or 2.");
					}
					relationContext = { depth };
				}
				const maxItems = draft.maxItems.trim()
					? parsePositiveInteger(draft.maxItems)
					: null;
				const maxOutputBytes = draft.maxOutputBytes.trim()
					? parsePositiveInteger(draft.maxOutputBytes)
					: null;
				const defaultLimits =
					maxItems != null || maxOutputBytes != null
						? { max_items: maxItems, max_output_bytes: maxOutputBytes }
						: null;
				reportFields = {
					scope_kind: draft.scopeKind,
					class_id: scopeNeedsClass ? classId : null,
					default_query: draft.defaultQuery.trim() || null,
					include,
					relation_context: relationContext,
					default_missing_data_policy: draft.missingDataPolicy,
					default_limits: defaultLimits,
				};
			}

			if (draft.mode === "create") {
				return createReportTemplate({ ...base, ...reportFields } as NewReportTemplate);
			}
			if (!draft.templateId) throw new Error("Template id is missing.");
			return updateReportTemplate(
				draft.templateId,
				{ ...base, ...reportFields } as UpdateReportTemplate,
			);
		},
```

In the `onSuccess` of this mutation, remove the `setOutputMode("template")` line (the `outputMode` state is removed in Task 5); keep the invalidate + `setSelectedTemplateId` + `setEditorState(null)` + `setEditorError(null)`.

- [ ] **Step 5: Add include-row handlers scoped to the editor state**

Add these helper functions inside the component (near `closeEditor`), operating on `editorState.includeRows`:

```tsx
	function addEditorIncludeRow() {
		setEditorState((current) =>
			current
				? { ...current, includeRows: [...current.includeRows, newIncludeRow(createBuilderId())] }
				: current,
		);
	}
	function updateEditorIncludeRow(id: string, patch: Partial<IncludeBuilderRow>) {
		setEditorState((current) =>
			current
				? {
						...current,
						includeRows: current.includeRows.map((row) =>
							row.id === id ? { ...row, ...patch } : row,
						),
					}
				: current,
		);
	}
	function removeEditorIncludeRow(id: string) {
		setEditorState((current) =>
			current
				? { ...current, includeRows: current.includeRows.filter((row) => row.id !== id) }
				: current,
		);
	}
```

- [ ] **Step 6: Editor modal JSX — add the new fields**

In the editor modal `<form>` (after the content-type control, before `<TemplateCodeEditor>`), add the `kind` selector and the report-only config block. Insert after the content-type `</label>`/`</div>` close (around line 1857) and before `<TemplateCodeEditor`:

```tsx
							<label className="control-field">
								<span>Kind</span>
								<select
									value={editorState.kind}
									onChange={(event) =>
										setEditorState({
											...editorState,
											kind: event.target.value as ReportTemplateKind,
										})
									}
								>
									<option value="report">report (executable)</option>
									<option value="fragment">fragment (include/import/extends)</option>
								</select>
							</label>

							{editorState.kind === "report" ? (
								<>
									<label className="control-field">
										<span>Scope</span>
										<select
											value={editorState.scopeKind}
											onChange={(event) =>
												setEditorState({
													...editorState,
													scopeKind: event.target.value as ReportScopeKind,
												})
											}
										>
											<option value="namespaces">Namespaces</option>
											<option value="classes">Classes</option>
											<option value="objects_in_class">Objects in class</option>
											<option value="class_relations">Class relations</option>
											<option value="object_relations">Object relations</option>
											<option value="related_objects">Related objects</option>
										</select>
									</label>

									{editorState.scopeKind === "objects_in_class" ||
									editorState.scopeKind === "related_objects" ? (
										<div className="control-field">
											<label htmlFor="template-class">Class</label>
											{classOptions.length > 0 ? (
												<select
													id="template-class"
													value={editorState.classId}
													onChange={(event) =>
														setEditorState({ ...editorState, classId: event.target.value })
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
													id="template-class"
													type="number"
													min={1}
													value={editorState.classId}
													onChange={(event) =>
														setEditorState({ ...editorState, classId: event.target.value })
													}
													placeholder="Enter class ID"
												/>
											)}
										</div>
									) : null}

									<label className="control-field control-field--wide">
										<span>Default query</span>
										<input
											value={editorState.defaultQuery}
											onChange={(event) =>
												setEditorState({ ...editorState, defaultQuery: event.target.value })
											}
											placeholder="name__contains=srv-&sort=name"
										/>
									</label>

									{editorState.scopeKind === "objects_in_class" ? (
										<IncludeRows
											rows={editorState.includeRows}
											classOptions={classOptions}
											onAdd={addEditorIncludeRow}
											onUpdate={updateEditorIncludeRow}
											onRemove={removeEditorIncludeRow}
										/>
									) : null}

									{editorState.scopeKind === "objects_in_class" ||
									editorState.scopeKind === "related_objects" ? (
										<label className="control-field">
											<span>Relation hydration depth</span>
											<input
												type="number"
												min={1}
												max={2}
												value={editorState.depth}
												onChange={(event) =>
													setEditorState({ ...editorState, depth: event.target.value })
												}
												placeholder={
													editorState.scopeKind === "related_objects" ? "2 (default)" : "Off"
												}
											/>
										</label>
									) : null}

									<label className="control-field">
										<span>Default missing data policy</span>
										<select
											value={editorState.missingDataPolicy}
											onChange={(event) =>
												setEditorState({
													...editorState,
													missingDataPolicy: event.target.value as ReportMissingDataPolicy,
												})
											}
										>
											<option value="strict">Strict</option>
											<option value="null">Null</option>
											<option value="omit">Omit</option>
										</select>
									</label>

									<label className="control-field">
										<span>Default max items</span>
										<input
											type="number"
											min={1}
											value={editorState.maxItems}
											onChange={(event) =>
												setEditorState({ ...editorState, maxItems: event.target.value })
											}
											placeholder="optional"
										/>
									</label>

									<label className="control-field">
										<span>Default max output bytes</span>
										<input
											type="number"
											min={1}
											value={editorState.maxOutputBytes}
											onChange={(event) =>
												setEditorState({ ...editorState, maxOutputBytes: event.target.value })
											}
											placeholder="optional"
										/>
									</label>
								</>
							) : null}
```

- [ ] **Step 7: Feed the editor from the form's own fields**

Replace the `<TemplateCodeEditor … />` props (lines 1860–1875) so scope/relation/aliases come from `editorState`:

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
								scopeKind={editorState.kind === "report" ? editorState.scopeKind : undefined}
								relationHydrated={
									editorState.kind === "report" &&
									(editorState.scopeKind === "related_objects" ||
										(editorState.scopeKind === "objects_in_class" &&
											editorState.depth.trim() !== ""))
								}
								relationAliases={includeAliasesOf(editorState.includeRows)}
							/>
```

- [ ] **Step 8: Verify reports-workspace's editor-area errors are resolved**

Run: `npm run typecheck 2>&1 | grep "reports-workspace" | grep -iE "editorState|TemplateEditor|buildTemplateEditorState|saveTemplate" || echo "editor-area: clean"`
Expected: `editor-area: clean` (other `reports-workspace` errors about the runner/`outputMode`/`submitReportTask` remain — fixed in Task 5).

- [ ] **Step 9: Commit**

```bash
git add src/components/reports-workspace.tsx
git commit -m "Add executable-template fields to the template editor form"
```

---

### Task 5: Two-tab report runner (JSON + run template)

**Files:**
- Modify: `src/components/reports-workspace.tsx`

Replaces the single runner form (output-mode toggle + inline include) with a segmented control: **JSON report** (builds `ReportRequest` → `submitJsonReportTask`) and **Run template** (select a `kind==="report"` template + overrides → `runTemplateReport`). Restores green.

**Interfaces:**
- Consumes: `submitJsonReportTask`, `runTemplateReport`, `ReportTemplateRunRequest`, `IncludeRows`, include helpers.

- [ ] **Step 1: Replace runner state**

Remove `outputMode` state (line 415). Replace the runner-related state region (lines 414–438) so it reads:

```tsx
	const [selectedTemplateId, setSelectedTemplateId] = useState("");
	const [runMode, setRunMode] = useState<"json" | "template">("json");
	const [scopeKind, setScopeKind] = useState<ReportScopeKind>("namespaces");
	const [classId, setClassId] = useState("");
	const [objectId, setObjectId] = useState("");
	const [advancedQueryText, setAdvancedQueryText] = useState("");
	const [missingDataPolicy, setMissingDataPolicy] =
		useState<ReportMissingDataPolicy>("strict");
	const [relationDepth, setRelationDepth] = useState("");
	const [maxItems, setMaxItems] = useState("100");
	const [maxOutputBytes, setMaxOutputBytes] = useState("262144");
	// run-template overrides
	const [overrideQuery, setOverrideQuery] = useState("");
	const [overrideObjectId, setOverrideObjectId] = useState("");
	const [overridePolicy, setOverridePolicy] = useState<ReportMissingDataPolicy | "">("");
	const [overrideMaxItems, setOverrideMaxItems] = useState("");
	const [overrideMaxOutputBytes, setOverrideMaxOutputBytes] = useState("");
	const [runnerError, setRunnerError] = useState<string | null>(null);
	const [lastReportTask, setLastReportTask] = useState<TaskResponse | null>(null);
	const [lastResult, setLastResult] = useState<ReportExecutionResult | null>(null);
	const [resultActionFeedback, setResultActionFeedback] =
		useState<ResultActionFeedback>(null);
	const [builderFilters, setBuilderFilters] = useState<QueryBuilderFilter[]>([]);
	const [builderSorts, setBuilderSorts] = useState<QueryBuilderSort[]>([]);
	const [includeRows, setIncludeRows] = useState<IncludeBuilderRow[]>([]);
```

The JSON-runner keeps its own `includeRows` (for `ReportRequest.include`); the include-row handlers `addIncludeRow`/`updateIncludeRow`/`removeIncludeRow` (lines 716–739) stay but rewrite `addIncludeRow` to use `newIncludeRow`:

```tsx
	function addIncludeRow() {
		setIncludeRows((current) => [...current, newIncludeRow(createBuilderId())]);
	}
```

- [ ] **Step 2: Derive the runnable (report-kind) templates and selected template**

Replace `selectedTemplate` memo (lines 474–480) and add a runnable list:

```tsx
	const runnableTemplates = useMemo(
		() => templates.filter((template) => template.kind === "report"),
		[templates],
	);
	const selectedTemplate = useMemo(
		() =>
			runnableTemplates.find(
				(template) => String(template.id) === selectedTemplateId,
			) ?? null,
		[selectedTemplateId, runnableTemplates],
	);
```

Update the stale-selection effect (lines 523–534) to drop `setOutputMode` and use `runnableTemplates`:

```tsx
	useEffect(() => {
		if (!selectedTemplateId) return;
		if (!runnableTemplates.some((t) => String(t.id) === selectedTemplateId)) {
			setSelectedTemplateId("");
		}
	}, [selectedTemplateId, runnableTemplates]);
```

Update the delete mutation's `onSuccess` (lines 635–641) to drop `setOutputMode("json")` (keep clearing `selectedTemplateId`). Update the "Use in runner" button (lines 953–962) to set `setRunMode("template")` instead of `setOutputMode("template")`.

- [ ] **Step 3: Replace the run mutation + add the template-run mutation**

Replace `runReportMutation` (lines 644–661) with two mutations sharing the same success/error handling helper:

```tsx
	const runReportMutation = useMutation({
		mutationFn: async (request: ReportRequest) => submitJsonReportTask(request),
		onSuccess: (task) => {
			setRunnerError(null);
			setLastReportTask(task);
			setLastResult(null);
			setResultActionFeedback(null);
		},
		onError: (error) => {
			setLastResult(null);
			setLastReportTask(null);
			setResultActionFeedback(null);
			setRunnerError(error instanceof Error ? error.message : "Failed to submit report.");
		},
	});

	const runTemplateMutation = useMutation({
		mutationFn: async (vars: { templateId: number; overrides: ReportTemplateRunRequest }) =>
			runTemplateReport(vars.templateId, vars.overrides),
		onSuccess: (task) => {
			setRunnerError(null);
			setLastReportTask(task);
			setLastResult(null);
			setResultActionFeedback(null);
		},
		onError: (error) => {
			setLastResult(null);
			setLastReportTask(null);
			setResultActionFeedback(null);
			setRunnerError(error instanceof Error ? error.message : "Failed to run template report.");
		},
	});
```

- [ ] **Step 4: Replace `handleRunReport` (JSON) and add `handleRunTemplate`**

Replace `handleRunReport` (lines 741–856) with a JSON-only version (no `output`; include via `buildIncludeFromRows`):

```tsx
	function handleRunReport(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const scope: ReportRequest["scope"] = { kind: scopeKind };
		if (scopeKind === "objects_in_class" || scopeKind === "related_objects") {
			const parsed = parsePositiveInteger(classId);
			if (!parsed) {
				setRunnerError("Class is required for the selected scope.");
				return;
			}
			scope.class_id = parsed;
		}
		if (scopeKind === "related_objects") {
			const parsed = parsePositiveInteger(objectId);
			if (!parsed) {
				setRunnerError("Object is required for the selected scope.");
				return;
			}
			scope.object_id = parsed;
		}

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

		let include: ReportInclude | null = null;
		if (scopeKind === "objects_in_class") {
			const built = buildIncludeFromRows(includeRows);
			if ("error" in built) {
				setRunnerError(built.error);
				return;
			}
			include = built.include;
		}

		setRunnerError(null);
		setResultActionFeedback(null);
		setLastResult(null);
		setLastReportTask(null);
		runReportMutation.mutate({
			scope,
			include,
			query: builtQuery || null,
			relation_context: relationContext,
			missing_data_policy: missingDataPolicy,
			limits: {
				max_items: parsePositiveInteger(maxItems),
				max_output_bytes: parsePositiveInteger(maxOutputBytes),
			},
		});
	}

	function handleRunTemplate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedTemplate) {
			setRunnerError("Select a template to run.");
			return;
		}
		const overrides: ReportTemplateRunRequest = {};
		if (overrideQuery.trim()) overrides.query = overrideQuery.trim();
		if (selectedTemplate.scope_kind === "related_objects") {
			const parsed = parsePositiveInteger(overrideObjectId);
			if (!parsed) {
				setRunnerError("This template is related_objects-scoped; an object id is required.");
				return;
			}
			overrides.object_id = parsed;
		}
		if (overridePolicy) overrides.missing_data_policy = overridePolicy;
		const oMaxItems = overrideMaxItems.trim() ? parsePositiveInteger(overrideMaxItems) : null;
		const oMaxBytes = overrideMaxOutputBytes.trim()
			? parsePositiveInteger(overrideMaxOutputBytes)
			: null;
		if (oMaxItems != null || oMaxBytes != null) {
			overrides.limits = { max_items: oMaxItems, max_output_bytes: oMaxBytes };
		}

		setRunnerError(null);
		setResultActionFeedback(null);
		setLastResult(null);
		setLastReportTask(null);
		runTemplateMutation.mutate({ templateId: selectedTemplate.id, overrides });
	}
```

- [ ] **Step 5: Runner JSX — segmented control + two panels**

In the runner `<article>` (lines 1005–1542), replace the header `<p className="muted">` text and the single `<form>` with a segmented control and two forms. Specifically:
1. Add a mode segmented control above the form:

```tsx
							<div className="action-row">
								<button
									type="button"
									className={runMode === "json" ? "" : "ghost"}
									onClick={() => setRunMode("json")}
								>
									JSON report
								</button>
								<button
									type="button"
									className={runMode === "template" ? "" : "ghost"}
									onClick={() => setRunMode("template")}
								>
									Run template
								</button>
							</div>
```

2. **JSON panel** (`runMode === "json"`): keep the EXISTING runner form body — Scope select, Class/Object (for the relevant scopes), the Query builder card, the Missing data policy, the Relation hydration depth, Max items, Max output bytes, the runnerError banner, and the submit button — but make these edits:
   - Remove the **Output mode** `<label>` (lines 1034–1045).
   - Remove the **Stored template** select block (lines 1106–1123).
   - Replace the inline "Related includes" block (lines 1339–1469) with the shared component:

```tsx
									{scopeKind === "objects_in_class" ? (
										<IncludeRows
											rows={includeRows}
											classOptions={classOptions}
											onAdd={addIncludeRow}
											onUpdate={updateIncludeRow}
											onRemove={removeIncludeRow}
										/>
									) : null}
```
   - Remove the `{selectedTemplate ? (<span>Template output type…</span>) : null}` next to the submit button.
   - Wrap this panel form so it only renders when `runMode === "json"`, with `onSubmit={handleRunReport}`.

3. **Template panel** (`runMode === "template"`): add this form:

```tsx
							{runMode === "template" ? (
								<form className="stack" onSubmit={handleRunTemplate}>
									<label className="control-field control-field--wide">
										<span>Template</span>
										<select
											value={selectedTemplateId}
											onChange={(event) => setSelectedTemplateId(event.target.value)}
										>
											<option value="">Select a report template</option>
											{runnableTemplates.map((template) => (
												<option key={template.id} value={template.id}>
													{template.name} ({template.content_type})
												</option>
											))}
										</select>
									</label>

									{selectedTemplate ? (
										<div className="preview-meta">
											<span>scope: {selectedTemplate.scope_kind ?? "n/a"}</span>
											{selectedTemplate.class_id != null ? (
												<span>class #{selectedTemplate.class_id}</span>
											) : null}
											{selectedTemplate.default_query ? (
												<span>default query: {selectedTemplate.default_query}</span>
											) : null}
											{selectedTemplate.relation_context?.depth != null ? (
												<span>depth {selectedTemplate.relation_context.depth}</span>
											) : null}
											<span>{selectedTemplate.content_type}</span>
										</div>
									) : null}

									<div className="form-grid">
										<label className="control-field control-field--wide">
											<span>Override query (optional)</span>
											<input
												value={overrideQuery}
												onChange={(event) => setOverrideQuery(event.target.value)}
												placeholder={selectedTemplate?.default_query ?? "name__contains=srv-"}
											/>
										</label>

										{selectedTemplate?.scope_kind === "related_objects" ? (
											<label className="control-field">
												<span>Object id</span>
												<input
													type="number"
													min={1}
													value={overrideObjectId}
													onChange={(event) => setOverrideObjectId(event.target.value)}
													placeholder="root object id"
												/>
											</label>
										) : null}

										<label className="control-field">
											<span>Override missing data policy</span>
											<select
												value={overridePolicy}
												onChange={(event) =>
													setOverridePolicy(
														event.target.value as ReportMissingDataPolicy | "",
													)
												}
											>
												<option value="">Use template default</option>
												<option value="strict">Strict</option>
												<option value="null">Null</option>
												<option value="omit">Omit</option>
											</select>
										</label>

										<label className="control-field">
											<span>Override max items</span>
											<input
												type="number"
												min={1}
												value={overrideMaxItems}
												onChange={(event) => setOverrideMaxItems(event.target.value)}
												placeholder="template default"
											/>
										</label>

										<label className="control-field">
											<span>Override max output bytes</span>
											<input
												type="number"
												min={1}
												value={overrideMaxOutputBytes}
												onChange={(event) => setOverrideMaxOutputBytes(event.target.value)}
												placeholder="template default"
											/>
										</label>
									</div>

									{runnerError ? <div className="error-banner">{runnerError}</div> : null}

									<div className="action-row">
										<button type="submit" disabled={runTemplateMutation.isPending || !selectedTemplate}>
											{runTemplateMutation.isPending ? "Submitting..." : "Run template"}
										</button>
									</div>
								</form>
							) : null}
```

   Note: the JSON panel's own `runnerError` banner stays inside the JSON form; the template form has its own copy above. Keep the existing scope-cleanup effect (filters/sorts) and the include-reset effect (lines 572–576) unchanged.

- [ ] **Step 6: Typecheck + lint (green restored)**

Run: `npm run typecheck && npm run lint`
Expected: BOTH PASS. (If `ReportRequest["output"]` or `submitReportTask` references remain anywhere, grep and remove them.)

- [ ] **Step 7: Commit**

```bash
git add src/components/reports-workspace.tsx
git commit -m "Split report runner into JSON and run-template modes"
```

---

### Task 6: include/import/extends name completion

**Files:**
- Modify: `src/lib/template-completion.ts`
- Modify: `src/components/template-code-editor.tsx`
- Modify: `src/components/reports-workspace.tsx`

**Interfaces:**
- Produces: `TemplateCompletionOptions` gains `templateNames?: string[]`; editor gains `templateNames?: string[]` prop.

- [ ] **Step 1: Add `templateNames` to the completion options + a string-literal branch**

In `src/lib/template-completion.ts`, extend the options type:

```ts
export type TemplateCompletionOptions = {
	scopeKind?: ReportScopeKind;
	relationHydrated: boolean;
	relationAliases?: string[];
	templateNames?: string[];
};
```

In `createTemplateCompletionSource`, after computing `before`/region but BEFORE the tag-keyword branch, add a string-literal completion for include/import/extends. Insert:

```ts
		// Inside a string after include/import/extends → offer template names.
		const nameMatch = region.match(
			/\b(?:include|import|extends)\s+("|')([A-Za-z0-9_.\-/]*)$/,
		);
		if (nameMatch) {
			const names = options.templateNames ?? [];
			if (!names.length) {
				return null;
			}
			const partial = nameMatch[2];
			const word = context.matchBefore(/[A-Za-z0-9_.\-/]*$/);
			return result(word ? word.from : context.pos, names.map((name) => ({
				label: name,
				detail: "Stored template",
				type: "text",
			})));
		}
```

(`result` and `context` are already in scope.)

- [ ] **Step 2: Thread the prop through the editor**

In `src/components/template-code-editor.tsx`, add `templateNames?: string[]` to `TemplateCodeEditorProps`, destructure it with default `[]`, include it in the `createTemplateCompletionSource({ … })` call, and add a stable dependency to the extensions `useMemo` (mirroring `relationAliasesKey`):

```tsx
	const templateNamesKey = (templateNames ?? []).join(",");
```
add `templateNamesKey` to the dependency array, and pass `templateNames` into the source options.

- [ ] **Step 3: Supply same-namespace template names from the workspace**

In `reports-workspace.tsx`, compute names filtered by the editor's namespace and pass them to the editor:

```tsx
	const editorTemplateNames = useMemo(() => {
		if (!editorState) return [];
		const ns = parsePositiveInteger(editorState.namespaceId);
		return templates
			.filter((t) => t.namespace_id === ns && t.id !== editorState.templateId)
			.map((t) => t.name);
	}, [editorState, templates]);
```

Add `templateNames={editorTemplateNames}` to the `<TemplateCodeEditor>` usage.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: BOTH PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/template-completion.ts src/components/template-code-editor.tsx src/components/reports-workspace.tsx
git commit -m "Autocomplete stored template names in include/import/extends"
```

---

### Task 7: Final verification

**Files:** none

- [ ] **Step 1: typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 2: lint** — `npm run lint` → PASS.
- [ ] **Step 3: build** — `npm run build` → completes without error.
- [ ] **Step 4: Manual reasoning checklist (record results)** — template editor: kind toggle hides/shows report config; report template saves scope_kind/class_id/default_query/include/relation_context/defaults; fragment saves only base fields; editor autocomplete reflects the form's scope + include aliases; include/import/extends offers same-namespace names. Runner: JSON tab builds ReportRequest (no output); Run-template tab lists only kind=report templates, requires object_id for related_objects, sends overrides only when set; failed/partial banners + expiry still work. Note which checks are reasoning-only (no backend).
- [ ] **Step 5: Commit any verification fixes** (if needed).

---

## Self-Review

**Spec coverage:**
- Regenerate from #55 → Task 1. ✓
- Split submission (JSON vs template-run) → Task 2. ✓
- Move scope/query/include/relation/defaults onto template → Task 4 (+ shared builder Task 3). ✓
- Two-tab runner → Task 5. ✓
- kind: report|fragment → Task 4 (editor) + Task 5 (runner filters to report). ✓
- include/import/extends name completion → Task 6. ✓
- Errors (429/404/410/partial banners/expiry) → preserved from prior work (Tasks 2 keeps 429; result console untouched). ✓
- No run-time depth override → honored (ReportTemplateRunRequest has no relation_context; template panel offers none). ✓

**Placeholder scan:** none. RED-until-Task-5 is explicit and intentional, with per-task targeted checks substituting for full green.

**Type consistency:** `submitJsonReportTask`/`runTemplateReport` signatures consistent across Tasks 2 and 5. `IncludeBuilderRow`/`buildIncludeFromRows`/`includeAliasesOf`/`includeRowsFromTemplate`/`newIncludeRow` consistent across Tasks 3, 4, 5. `IncludeRows` prop shape consistent (Tasks 3, 4, 5). `TemplateCompletionOptions.templateNames` consistent (Task 6). Template fields (`scope_kind`, `class_id`, `default_query`, `include`, `relation_context`, `default_missing_data_policy`, `default_limits`, `kind`) match the verified #55 schema.

**Note:** `reports-workspace.tsx` grows further. Extraction of the template-editor form and runner into child components is a recommended follow-up but is intentionally out of scope here to bound risk during the breaking migration.
