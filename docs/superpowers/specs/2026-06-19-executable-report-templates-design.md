# Design: Adapt to executable report templates (hubuum PR #55)

**Date:** 2026-06-19
**Status:** Approved (design), pending spec review
**Author:** Claude (brainstorming session with Terje Kvernes)
**Builds on:** `docs/superpowers/specs/2026-06-18-minijinja-async-reports-relations-design.md`
**Amends:** branch `feat/minijinja-async-reports` (PR #2) — the executable-template
workflow replaces the `output.template_id` mechanism that PR #2 introduced but
that never shipped.

## Background

hubuum PR #55 ("Streamline executable report templates", branch
`clean-executable-report-templates`, **open/unmerged**) reshapes how stored
templates are reused:

- A **new dedicated endpoint** `POST /api/v1/templates/{template_id}/reports`
  runs a stored template and returns its `content_type` output.
- `POST /api/v1/reports` is now **JSON-only**; the `output.template_id`
  mechanism (and the `ReportOutputRequest` schema) is **removed**.
- **Templates become self-describing/executable**: they now carry `kind`,
  `scope_kind`, `class_id`, `default_query`, `include`, `relation_context`,
  `default_missing_data_policy`, `default_limits`. Scope/class/include/
  relation_context/content_type live on the template; only `query`/`object_id`/
  `limits`/`missing_data_policy` are run-time overrides.

This is the "much better interface to reuse templates": define scope, query
defaults, includes, and hydration once on the template, then run it (optionally
overriding query/limits) — instead of re-specifying everything per report run.

Since PR #55 is **open**, its `openapi.json` is a moving target; we regenerate
the client from that branch now and accept that a re-regeneration may be needed
if #55 changes before merge.

## Goals

Adapt the frontend (on PR #2's branch) to the PR #55 contract:
1. Regenerate the API client/models from #55's `openapi.json`.
2. Split report submission into JSON reports vs. template execution.
3. Move scope/query/include/relation_context/defaults onto the template
   create/edit form.
4. Give the runner two explicit modes (JSON report / run a template).
5. Support `kind: fragment` templates (composition partials).
6. Autocomplete same-namespace template names in `include`/`import`/`extends`.

## Non-goals (unchanged from prior spec)

- Related-graph visualization, streaming search, idempotency-key wiring,
  class-level `/related/relations`.
- Run-time `relation_context.depth` override (the docs mention it, but the
  `ReportTemplateRunRequest` schema omits it — see Open questions).

## Authoritative #55 contract (from the branch `openapi.json`, verified)

### Endpoints
- `POST /api/v1/reports` → `202` + `TaskResponse`. Body `ReportRequest`
  (JSON-only output).
- `POST /api/v1/templates/{template_id}/reports` →
  `operationId: postApiV1TemplatesByTemplateIdReports`, `202` + `TaskResponse`,
  responses incl. `400/401/403/404/409/429`. Body `ReportTemplateRunRequest`.
- `GET /api/v1/reports/{task_id}/output` — unchanged (output fetch identical for
  both workflows; only the returned `content_type` differs).
- Template CRUD unchanged paths: `GET/POST /api/v1/templates`,
  `PATCH/DELETE /api/v1/templates/{id}`.

### Schemas (field → type; `*` = required)
- **`ReportTemplateRunRequest`**: `query?: string|null`,
  `object_id?: integer|null`, `limits?: ReportLimits|null`,
  `missing_data_policy?: ReportMissingDataPolicy|null`. (No `scope`, no
  `include`, no `relation_context` — all taken from the template.)
- **`ReportRequest`** (JSON): `scope*: ReportScope`, `query?`, `include?`,
  `relation_context?`, `limits?`, `missing_data_policy?`. **No `output` field.**
- **`ReportTemplate`** / **`NewReportTemplate`**:
  `name*`, `description*` (Update: nullable), `namespace_id*`, `content_type*`,
  `template*`, `kind*: ReportTemplateKind`, `scope_kind?: ReportScopeKind|null`,
  `class_id?: integer|null`, `default_query?: string|null`,
  `include?: ReportInclude|null`, `relation_context?: ReportRelationContext|null`,
  `default_missing_data_policy?: ReportMissingDataPolicy|null`,
  `default_limits?: ReportLimits|null`. (`ReportTemplate` adds `id*`,
  `created_at*`, `updated_at*`.) `UpdateReportTemplate` = all writable fields
  optional/nullable.
- **`ReportTemplateKind`**: enum `['report', 'fragment']`.
- **`ReportScopeKind`**: enum `['namespaces','classes','objects_in_class','class_relations','object_relations','related_objects']`.
- **`ReportInclude`**: `related_objects?: { [alias]: ReportIncludeRelatedObject } | null`.
- **`ReportIncludeRelatedObject`**: `class_id*: integer`,
  `class_relation_id?: integer|null`, `direction?: ReportIncludeRelatedDirection`,
  `limit?: integer|null`, `max_depth?: integer|null`,
  `sort?: ReportIncludeRelatedSort`.
- **`ReportIncludeRelatedDirection`**: `['any','outgoing','incoming']`.
  **`ReportIncludeRelatedSort`**: `['path','name','created_at']`.
- **`ReportRelationContext`**: `depth?: integer|null`.
- **`ReportLimits`**: `max_items?`, `max_output_bytes?`.
- **`ReportMissingDataPolicy`**: `['strict','null','omit']`.
- **`ReportOutputRequest`**: **removed.**

### Runtime rules (prose; not in schema — enforce client-side)
- Template `content_type` ∈ `text/plain | text/html | text/csv`
  (`application/json` does not use stored templates).
- `include`: ≤ 8 aliases; alias regex `^[A-Za-z_][A-Za-z0-9_]*$`; per-include
  `limit ∈ 1..50` (default 1), `max_depth ∈ 1..10` (default 1).
- `relation_context.depth ∈ 1..2` (default 2). For `objects_in_class` it
  enables hydration; for `related_objects` it overrides the default.
- `related_objects` run requires an `object_id` (stored on template or supplied
  as a run override); backend verifies `object_id` belongs to `class_id`.
- Errors: `429` too many active tasks; `400` if `cursor` in query; `413` if
  output exceeds `max_output_bytes`.

## Architecture & approach

### A. Client regeneration (`openapi.json`, `src/lib/api/generated/**`)
Replace the frontend `openapi.json` with #55's branch copy; run
`npm run gen:api` (orval + the BFF-prefix patch). Adopt #55's spec wholesale —
that is the target. Review the regenerated diff; the only hand-written consumers
that should break are in `reporting.ts` and `reports-workspace.tsx` (report/
template area). If unrelated endpoints shift, that reflects #55's branch state
and is accepted as part of "target that spec." Generated files remain
non-hand-edited.

### B. `reporting.ts` — split submission + new template fields
- Replace `submitReportTask` with two functions:
  - `submitJsonReportTask(request: ReportRequest, idempotencyKey?): Promise<TaskResponse>`
    → `postApiV1Reports` (body has no `output`).
  - `runTemplateReport(templateId: number, overrides: ReportTemplateRunRequest, idempotencyKey?): Promise<TaskResponse>`
    → `postApiV1TemplatesByTemplateIdReports`.
  - Both: `credentials: "include"`, 202 success, the existing 429 branch.
- `fetchReportTask` / `fetchReportOutput` unchanged (incl. 404/410 handling).
- Template CRUD payload/types pick up the new fields automatically via the
  regenerated `NewReportTemplate`/`UpdateReportTemplate`/`ReportTemplate`.
- Re-export `ReportTemplateKind`, `ReportTemplateRunRequest`; remove the
  `ReportOutputRequest` re-export (it no longer exists). Keep
  `StoredReportContentType` (`Exclude<ReportContentType, "application/json">`) —
  it does not depend on the removed schema and still expresses the text-only
  template content-type restriction.

### C. Template editor form (`reports-workspace.tsx` template modal)
The create/edit modal becomes the home for reuse config. New `TemplateEditorState`
fields: `kind`, `scopeKind`, `classId`, `defaultQuery`, include rows, `depth`,
`missingDataPolicy`, `maxItems`, `maxOutputBytes`.

Form layout:
- Always: namespace, name, description, content_type (text/* only), `kind`
  selector (`report` | `fragment`), template body editor.
- **`kind === "fragment"`**: hide all scope/run config (fragments are
  composition partials referenced by `include`/`import`/`extends`).
- **`kind === "report"`**: show `scope_kind` selector; `class_id` (for
  `objects_in_class`/`related_objects`); `default_query`; the **include builder**
  (relocated from the runner — `objects_in_class` only); `relation_context.depth`
  (1..2; shown for `objects_in_class`/`related_objects`);
  `default_missing_data_policy`; `default_limits` (max_items/max_output_bytes).

The embedded `TemplateCodeEditor` is fed from the form:
- `scopeKind` = form `scopeKind`.
- `relationHydrated` = `scopeKind === "related_objects" || (scopeKind === "objects_in_class" && depth set)`.
- `relationAliases` = the form's validated include aliases.
- `templateNames` (new prop) = same-namespace template names (for include-name
  completion — see E).

Client validation on save: `report` kind requires `scope_kind`;
`objects_in_class`/`related_objects` require `class_id`; include rules (≤8,
regex, limit 1..50, max_depth 1..10); depth 1..2. `fragment` kind requires only
name/description/content_type/template. Assemble `NewReportTemplate`/
`UpdateReportTemplate` with the new fields (omit empty optionals).

### D. Report runner — two tabs (`reports-workspace.tsx`)
Replace the `outputMode: json|template` dropdown with a segmented control:
- **JSON report**: the existing scope/query/include/relation_context/limits/
  policy builder, assembling `ReportRequest` (no `output`) →
  `submitJsonReportTask`. (Per-run include stays here for JSON reports.)
- **Run template**: select a `kind === "report"` template (fragments excluded);
  display its stored config read-only (scope_kind, class_id, default_query,
  include aliases, depth, content_type); allow run-time overrides — `query`,
  `object_id` (when `scope_kind === "related_objects"`), `limits`
  (max_items/max_output_bytes), `missing_data_policy` — assembling
  `ReportTemplateRunRequest` → `runTemplateReport(templateId, overrides)`. Empty
  overrides are omitted so the template defaults apply.
Both feed the same async result console (polling, banners, output, expiry) from
the prior spec — unchanged.

Run validation: `related_objects` template needs an `object_id` from either the
template's stored config or the run override; if neither, block with a message.

### E. Completion source (`template-completion.ts`, `template-code-editor.tsx`)
- Resolver logic unchanged (scope-aware fields, relation domains, subscripts).
  It is now fed from the template form (D's wiring) instead of the runner.
- **New**: `include`/`import`/`extends` name completion. Add a `templateNames?:
  string[]` option to `TemplateCompletionOptions` and a matching editor prop.
  When the cursor is inside a string literal immediately following
  `include`/`import`/`extends` (e.g. `{% include "<here>` ), offer the template
  names. Parent supplies same-namespace template names (already available via the
  templates query, filtered by the form's namespace).

### F. Components / units of change

| Unit | File | Change |
|------|------|--------|
| API spec + client | `openapi.json`, `src/lib/api/generated/**` | Regenerate from #55 branch (gen:api). |
| Reporting wrapper | `src/lib/api/reporting.ts` | Split submit (JSON vs template-run); new template fields; re-exports. |
| Template editor form | `src/components/reports-workspace.tsx` | kind/scope/class/default_query/include/depth/policy/limits; fragment vs report; feed editor. |
| Report runner | `src/components/reports-workspace.tsx` | Two-tab modes; template-run overrides; wire both endpoints. |
| Completion source | `src/lib/template-completion.ts` | `templateNames` option + include/import/extends name completion. |
| Editor props | `src/components/template-code-editor.tsx` | Pass `templateNames`; scope/relation props sourced from template form. |

`reports-workspace.tsx` is already large and will grow. Where the template
editor form and the runner become unwieldy, extract them into focused child
components (e.g. `template-editor-form.tsx`, `report-runner.tsx`) — a targeted
improvement justified by this change.

## Error handling
- Save: client-side validation per C (specific messages; block submit).
- Run: 429 (too many tasks) surfaced on submit; failed/cancelled/partial banners
  and 404/410 expiry handling from the prior spec are reused unchanged.
- `related_objects` missing `object_id`: blocked client-side before submit.

## Testing / verification
No unit-test runner (per repo). Gates: `npm run typecheck`, `npm run lint`
(Biome), `npm run build` — all clean. Manual reasoning of each completion/UX
path against the contract; live-backend behaviour noted as un-verifiable here.
The regeneration step is verified by a clean typecheck after fixing consumers.

## Open questions / assumptions
- **Run-time depth override**: `ReportTemplateRunRequest` has no
  `relation_context`, so the UI does **not** offer a depth override when running
  a template (depth is fixed on the template). The #55 docs example shows one;
  we follow the schema. Revisit if #55's schema adds it before merge.
- **`scope_kind` breadth**: the enum allows all six scopes; the #55 docs
  emphasize `objects_in_class`/`related_objects` for executable templates. The
  UI offers all six but only wires class_id/include/object_id semantics where
  they apply; other scopes get scope_kind + default_query + defaults only.
- **#55 is unmerged**: regenerating may surface unrelated diffs vs. our baseline
  `openapi.json`; we adopt #55's spec wholesale and fix breaks. A re-regeneration
  may be needed when #55 finalizes.
- **content_type for fragments**: fragments still carry a `content_type`
  (text/*); assumed used for autoescape behaviour when composed. UI keeps the
  content_type selector for fragments.
