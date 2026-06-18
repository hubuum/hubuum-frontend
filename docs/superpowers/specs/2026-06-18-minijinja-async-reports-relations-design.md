# Design: Complete the MiniJinja + async-reports + relations migration

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Author:** Claude (brainstorming session with Terje Kvernes)

## Background

The Hubuum backend changed in three ways relevant to the frontend:

1. The self-rolled report template language was replaced by **MiniJinja** (Jinja
   syntax) for stored report templates.
2. **Reports became asynchronous** (task-based): `POST /api/v1/reports` returns
   `202 Accepted` + a `TaskResponse`, clients poll the task, then fetch stored
   output.
3. **Relations in templates changed**: hydrated objects now expose
   `related` / `reachable` / `paths`, and reports can hydrate related objects via
   `include.related_objects.<alias>`.

A large, **uncommitted, in-progress migration already exists in the working tree**
and currently typechecks cleanly:

- `openapi.json` + the entire generated client/models were regenerated from the
  new backend (new models: `reportInclude*`, `reportRelationContext`,
  `reportTaskDetails`, `unifiedSearch*`, related-graph models, etc.).
- `@codemirror/lang-jinja` was added; `template-code-editor.tsx` was rewritten
  (~300 lines removed) and `template-suggestions.ts` reworked toward Jinja.
- `reporting.ts`, `reports-workspace.tsx`, `task-detail.tsx` were adapted to the
  async task flow.
- `search`, `tasks`, and related-list endpoints are **already wired** into real
  pages (`/search`, `/tasks`, relations explorer, object-detail).

This effort is therefore **"verify & complete"**, not greenfield. An audit
(three parallel reviews against the backend `template_guide.md` and
`report_api.md`) identified the gaps below.

## Goals

Complete and correct the migration across four areas:

- **A.** MiniJinja template autocomplete correctness.
- **B.** Relations-in-templates support in the editor (expansion + coloring).
- **C.** Async report error-state UX.
- **D.** `include.related_objects` report-builder UI (chosen extra scope; it is
  how relation aliases enter a report, so it complements B).

## Non-goals (explicitly deferred to separate efforts)

- Related-**graph** visualization (`/related/graph` endpoints exist, no UI).
- Streaming search (`/api/v1/search/stream` + SSE; non-streaming search works).
- Idempotency-Key wiring for report submission.
- Class-level `/related/relations` consistency gap.
- Any change to the generated client/models or `openapi.json` (treated as the
  source of truth as currently regenerated).

## Authoritative backend contract (reference)

### Templates (MiniJinja)
- Engine: MiniJinja (Jinja syntax). Stored templates support **only**
  `text/plain`, `text/html`, `text/csv`. `application/json` does **not** use
  stored templates.
- Context top-level keys: `items`, `meta`, `warnings`, `request`, and `source`
  (`source` only for templated `related_objects` reports; equals `items[0]`).
- Per-item object fields (all items): `id`, `name`, `description`,
  `namespace_id`, `hubuum_class_id`, `data`, `created_at`, `updated_at`, `path`,
  `path_objects`. Hydrated relation objects additionally expose `related`,
  `reachable`, `paths`.
- Core tags: `for/endfor`, `if/else/endif`, `set`, `include`, `import`,
  `extends`, `macro/endmacro`. `include/import/extends` resolve **only** within
  the same namespace; names with `/` or `::` are rejected. Composition naming
  convention: `layout.<name>`, `macros.<name>`, `partial.<name>`, `report.<name>`.
- Operators: `== != < <= > >=`, `and or not`, `in`, `+ - * / // %`, `~` (concat),
  indexing (`item.name`, `items[0]`, `item.related["rooms"]`).
- Standard filters: `length`, `sort`, `default(...)`. Tests: `is defined`,
  `is none`, `is string`, `is sequence`.
- **Custom Hubuum helpers** (not stock Jinja): `csv_cell`, `tojson`,
  `coalesce(...)`, `default_if_empty(...)`, `format_datetime(...)`,
  `join_nonempty(...)`.
- HTML templates are autoescaped; plain-text/CSV should use `tojson`/`csv_cell`
  for sensitive values.
- `missing_data_policy`: `strict | null | omit`.

### Relations in templates
- `include.related_objects` is supported **only by `objects_in_class` reports**
  ("objects_in_class reports can include related objects for every returned
  object"). For `related_objects` scope, relation hydration is **automatic via
  the scope** — no include rows.
- `include.related_objects.<alias>` hydration: the alias becomes a key under each
  item's `related` map → `item.related.<alias>` in templates (and
  `related.<alias>` in JSON). Included values are **always arrays** (even when
  `limit` is 1); each related object has normal object fields **plus** `path`.
  At most **8 aliases**. The top-level `related` item field is reserved for these
  includes.
- Alias name **must match `[A-Za-z_][A-Za-z0-9_]*`** (a request can include at
  most 8 aliases). Per-include `limit` defaults to 1 and must be **1..50**
  (applied per root object and per alias); `max_depth` defaults to 1 and must be
  **1..10**. `direction` ∈ {any (default), outgoing, incoming}; `sort` ∈ {path
  (default), name, created_at}.
- **Three maps use different alias domains:**
  - `related` — adjacent objects grouped by **relation alias** (and the include
    aliases above); direct neighbors only; preserves hop-by-hop shape.
  - `reachable` — flattened companion; direct + transitive within depth budget;
    grouped by the reachable object's **class alias**; deduped by id; shortest
    path. `reachable.<classAlias>` appears only when ≥1 visible object exists
    (guard with `is defined`).
  - `paths` — like `reachable` (grouped by the reachable object's **class
    alias**) but preserves multiple routes; each entry exposes `path` (number[])
    and `path_objects` (object[]), e.g. `person.path_objects[1].name`.
- Traversal is bidirectional. Hydration requires `relation_context` (for
  `objects_in_class`) or the `related_objects` scope; without it, `items` is a
  plain list with no `related.*`/`reachable.*`. `relation_context.depth` is `1`
  or `2`; default depth 2.
- Relation/class aliases are derived from
  `forward_template_alias`/`reverse_template_alias`, else inferred plural
  (Room→rooms, Person→persons, "Access Policy"→access_policies) — i.e. **not
  statically known to the frontend** except for the user-configured include
  aliases (which populate `related` only).
- Loop variables are arbitrary (`{% for host in items %}`,
  `{% for person in room.related.persons %}`), so completion must bind loop
  variables rather than assume `item`.
- `source`: for templated `related_objects` reports, equals the hydrated root
  object (== `items[0]`).

### Async reports
- `POST /api/v1/reports` → `202 Accepted`, body `TaskResponse`,
  `Location: /api/v1/tasks/{id}`, supports `Idempotency-Key`, returns `429` when
  too many active report tasks for the user.
- `GET /api/v1/reports/{task_id}` → task projection; poll until terminal.
  Terminal statuses: `succeeded`, `failed`, `partially_succeeded`, `cancelled`.
  Active: `queued`, `validating`, `running`. Optional `details.report.*`:
  `output_url`, `output_available`, `output_expires_at`, `template_name`,
  `output_content_type`, `warning_count`, `truncated`.
- `GET /api/v1/reports/{task_id}/output` → stored output; refetchable until
  cleanup; does not rerun. Response headers `X-Hubuum-Report-Warnings`,
  `X-Hubuum-Report-Truncated`. JSON envelope:
  `{ items, meta:{count,truncated,scope,content_type}, warnings }`.
- Content type fixed at submission: `output.template_id` → template's
  content_type; else `application/json`. Non-JSON requires a `template_id`.
- Limits: `max_items`, `max_output_bytes` (>0, ≤ server cap; exceeding fails the
  task with `413`); `cursor` in query → `400`.
- Relevant generated models:
  - `ReportInclude { related_objects?: { [alias]: ReportIncludeRelatedObject } | null }`
  - `ReportIncludeRelatedObject { class_id: number (required); class_relation_id?: number|null; direction?: 'any'|'outgoing'|'incoming'; limit?: number|null; max_depth?: number|null; sort?: 'path'|'name'|'created_at' }`
  - `ReportRelationContext { depth?: number|null }`
  - The numeric/count rules — `relation_context.depth ∈ 1..2`, include `limit ∈
    1..50` (default 1), include `max_depth ∈ 1..10` (default 1), `≤ 8 aliases`,
    alias regex `[A-Za-z_][A-Za-z0-9_]*` — are **runtime** rules documented in
    prose, not encoded in the OpenAPI schema → enforce as client-side validation.

## Architecture & approach

### Key decision: one custom CodeMirror completion source (covers A + B)

`@codemirror/lang-jinja@6.0.1` is kept for **parsing and syntax highlighting**,
but its completion has two hard limits we cannot configure around:

1. No hook for filter/function completion (after `|`).
2. Its property walker (`resolveProperties`) bails on any `SubscriptExpression`
   (`[0]`, `["rooms"]`), so deep relation navigation can't fire through it. The
   existing `getJinjaProperties` callback also only returns results one level
   under `item`/`source`.

Therefore we add **our own CodeMirror completion source** layered with
lang-jinja's language support, reusing the field-set data already in
`template-suggestions.ts`. This single source handles:

- Filters/functions after `|` and bare helper/function names.
- Multi-level property navigation, unwrapping `SubscriptExpression` so
  `item.related.rooms[0].name` and `paths.persons[0].path_objects[1].name`
  continue completing.
- Generic hydrated-object field completion after an alias hop, with `path` /
  `path_objects` offered specifically on `paths` entries.

Rejected alternative: only removing the depth gate in the existing callback.
Simpler, but leaves the contract's core subscript examples
(`related.room[0].name`, `path_objects[1]`) unsupported. Not chosen.

The completion source walks the Lezer syntax tree from the cursor: collect the
member/subscript chain back to a root `VariableName`, normalize subscripts to
"unwrap to element", and resolve the resulting logical path against a
scope-aware field model. It returns `Completion[]` for the current segment.

### Scope-aware field model (`template-suggestions.ts`)

Refactor the suggestion data into a single resolver that, given
`(scopeKind, hydrationEnabled, knownAliases)`, can answer "what completions are
valid at logical path P?":

- Roots: `items`, `meta`, `warnings`, `request`, plus `source` only when
  `scopeKind === 'related_objects'`. **Loop variables are bound dynamically**
  (see below), not hardcoded to `item`.
- **Loop-variable binding (required for canonical patterns).** The docs use
  arbitrary loop names: `{% for host in items %}`, `{% for room in host.related.rooms %}`,
  `{% for person in room.related.persons %}`. The completion resolver must scan
  the enclosing `{% for X in <expr> %}` blocks at the cursor, bind each `X` to
  the **element type** of `<expr>`, and resolve completions through those
  bindings. Element-type resolution: iterating a list-of-objects (e.g. `items`,
  `host.related.rooms`, `host.reachable.persons`, `host.paths.persons`) yields an
  **object**; iterating a relation/class-alias map is not a typical pattern but
  resolves to unknown. Practically: any loop variable bound over an
  object-valued iterable gets the full object completion set (universal fields +
  scope extras + relation maps when hydrated). `item` is just the conventional
  name, handled by the same mechanism — no special case.
- Resolver value "kinds": **object** (universal fields + scope extras + relation
  maps when hydrated), **relation-alias map** (`related`), **class-alias map**
  (`reachable`, `paths`), **list-of-object**, and **unknown**. The tree walk
  resolves a path/loop-binding expression to one of these kinds; subscripting a
  list/map unwraps to its element.
- Universal per-object fields available on any object value (loop var,
  `source`, related/reachable/paths entry): `id, name, description,
  namespace_id, hubuum_class_id, data, created_at, updated_at, path,
  path_objects`.
- Scope-specific item fields kept per scope (e.g. `classes`:
  `validate_schema`, `json_schema`, `namespace.*`; relation scopes: their FK
  fields). Reuse the existing `MANUAL_SCOPE_EXTRAS` content, minus anything now
  promoted to universal.
- `related`/`reachable`/`paths` offered on any object value **only** when
  hydration is possible (`related_objects`, or `objects_in_class` with
  `relation_context`). **Alias domains differ — handle separately:**
  - After `related.`: relation/include aliases. Offer `knownAliases` (the
    configured `include.related_objects` aliases from D) when provided; else no
    concrete labels (free-form). Resolves to an object (an include entry; it is
    an array, so `related.<alias>[n].<field>`).
  - After `reachable.` / `paths.`: grouped by the reachable object's **class
    alias**, which is not statically known → offer no concrete labels (generic
    fallback). Do **not** offer `knownAliases` here.
  - After an alias segment (any of the three): generic object completion. For
    `paths` entries additionally surface usable `path` (number[]) and
    `path_objects` (object[]); `path_objects[n]` unwraps to an object.
- `meta.*` / `request.*`: keep only fields confirmed against the contract.
  - `meta`: keep `meta.count`, `meta.truncated`, `meta.content_type`, and
    `meta.scope.{kind,class_id,object_id}` — all present in the documented JSON
    envelope (`meta:{count,truncated,scope,content_type}`). (The audit flagged
    `meta.content_type` as conflicting with the task-level `output_content_type`,
    but they are distinct: `meta.content_type` is the in-template field and is
    documented, so it stays.)
  - `request`: keep `request.scope.{kind,class_id,object_id}` and
    `request.query` (these mirror the submitted `ReportRequest`); drop any
    sub-paths not corresponding to a `ReportRequest` field.

### Helpers/filters data

Add a static list of helper completions with type tags ("filter" vs
"function") and short docs: `csv_cell`, `tojson`, `coalesce`,
`default_if_empty`, `format_datetime`, `join_nonempty`, `length`, `sort`,
`default`, and the tests (`defined`, `none`, `string`, `sequence`). Offered by
the custom source after `|` (filters) and where a callable is valid (functions
`coalesce`, `join_nonempty`, etc.).

### Editor props (`template-code-editor.tsx`)

The editor already receives `scopeKind`. Extend its props to also accept:

- `hydrationEnabled: boolean` — whether `related/reachable/paths` apply.
- `relationAliases?: string[]` — known `include.related_objects` aliases (from
  D). Used to offer concrete alias names **only at `related.`** (not
  `reachable.`/`paths.`, which use class aliases). Optional; falls back to
  generic free-form when absent.

These thread the scope-aware model into the custom completion source.

### Coloring

No custom highlight rules required — lang-jinja's grammar already colors member,
subscript, and indexed access correctly. The only action is **deleting orphaned
`.cm-template-delimiter` / `.cm-template-keyword` / `.cm-template-path` CSS**
(light + dark) in `globals.css`. Optional: add a `HighlightStyle` for the Lezer
Jinja tags if theming is desired — deferred unless visuals look off.

### C. Async report error-state UX

- `reports-workspace.tsx` result console: branch on task status.
  - `failed` / `cancelled`: danger banner including `activeReportTask.summary`.
  - `partially_succeeded` without output: warning banner + summary.
  - `succeeded` / `partially_succeeded` with `output_available !== true`: keep
    the neutral "no stored output" message.
- Display `reportDetails.output_expires_at` in the runner's result meta (it is
  already shown in `task-detail.tsx`).
- Output fetch errors: special-case `404`/`410` as "output has expired or was
  cleaned up"; keep generic message otherwise. (`reporting.ts` `fetchReportOutput`
  should distinguish these statuses.)
- Submit errors: special-case `429` ("too many active report tasks — try again
  later") in `reporting.ts` `submitReportTask` / surfaced by the workspace.
  `413` surfaced via the failed-task summary path (task fails server-side).
- `relation_context.depth` control: render **only** for
  `scopeKind === 'objects_in_class'` (per docs, `relation_context.depth` is `1`
  or `2` and only applies there). Validate to the integer range `1..2` in
  `handleRunReport` (not just the input `max` attribute), and only send
  `relation_context` for that scope.

### D. `include.related_objects` builder (`reports-workspace.tsx`, `reporting.ts`)

- New "Related includes" section in the report builder, shown **only for
  `scopeKind === 'objects_in_class'`**. Per the docs, "objects_in_class reports
  can include related objects"; for `related_objects` scope, relation hydration
  is **automatic via the scope** (`items` becomes `[source]`, `source` is the
  hydrated root) — so no include UI is shown there. (Do not offer the include
  builder for any other scope.)
- A list of include rows; each row:
  - `alias` (text, required, unique) — must match the backend regex
    `^[A-Za-z_][A-Za-z0-9_]*$`. Reject leading digits, dashes, dots, spaces.
  - `class_id` (required) — class selector consistent with existing class
    pickers in the workspace.
  - `direction` (`any` default / `outgoing` / `incoming`).
  - `sort` (`path` default / `name` / `created_at`, optional).
  - `limit` (integer `1..50`, optional; backend default 1).
  - `max_depth` (integer `1..10`, optional; backend default 1).
  - `class_relation_id` (optional; advanced — include only if a simple selector
    exists, otherwise omit from v1 and document).
- Client-side validation: at most **8** aliases; aliases unique and matching the
  regex; `limit ∈ 1..50`; `max_depth ∈ 1..10`. These limits are backend runtime
  rules (not in the OpenAPI schema), enforced client-side to avoid valid-looking
  requests the server will reject.
- `handleRunReport` builds `include.related_objects` as
  `{ [alias]: { class_id, direction?, sort?, limit?, max_depth?, class_relation_id? } }`
  and sets `ReportRequest.include` (omit when empty).
- The configured alias names are passed to `TemplateCodeEditor` via
  `relationAliases` so B can autocomplete them **at `item.related.<alias>`**
  (the domain where include aliases live).

## Components / units of change

| Unit | File | Change |
|------|------|--------|
| Suggestion model + helpers data | `src/lib/template-suggestions.ts` | Scope-aware resolver; promote universal item fields; gate `source`/relation maps; add helper/filter/test data; delete `validateTemplateExpression`, `getValidTemplatePaths`, `ROOT_TEMPLATE_SUGGESTIONS`; prune speculative paths. |
| Custom completion source | `src/components/template-code-editor.tsx` (or a new `src/lib/template-completion.ts`) | Tree-walking completion source handling deep paths + subscripts + filters; loop-variable binding (`{% for X in expr %}`); domain-aware `related` vs `reachable`/`paths` aliases; new `hydrationEnabled`/`relationAliases` props. |
| Editor help text | `src/components/reports-workspace.tsx` (`TEMPLATE_HELP`, placeholder, default body) | Mention helpers, HTML autoescape, composition naming; fix literal `\n`. |
| Orphaned CSS | `src/app/globals.css` | Remove `.cm-template-*` rules. |
| Report error UX | `src/components/reports-workspace.tsx`, `src/lib/api/reporting.ts` | Status-branched banners + summary; `output_expires_at`; 404/410/429 handling; depth control gating. |
| Include builder | `src/components/reports-workspace.tsx`, `src/lib/api/reporting.ts` | New includes section; wire `ReportRequest.include`; pass aliases to editor. |

Where the completion logic grows large, extract it to a dedicated
`src/lib/template-completion.ts` so `template-code-editor.tsx` stays focused on
the CodeMirror wiring.

## Error handling

- Completion source must never throw on partial/invalid syntax — return `null`
  (no completions) when the tree can't be resolved.
- Report submission/fetch errors map to specific user-facing messages by HTTP
  status (429, 413 via task summary, 404/410 expiry); all other errors fall back
  to the existing generic messages.
- Include builder validates client-side before submit; server-side rejections
  surface via the failed-task summary path.

## Testing / verification

This repo has no unit-test runner (scripts: `dev`, `build`, `lint` = biome,
`typecheck` = `next typegen && tsc --noEmit`, `gen:api`). Verification is:

- `npm run typecheck` clean.
- `npm run lint` clean.
- Manual reasoning of each completion path and report UX state against the
  contract above, documented in the implementation plan's verification steps.
- Anything requiring a live backend (actual 429/413/expiry responses, real alias
  hydration) will be called out as un-verifiable in this environment and checked
  by reasoning + types only.

## Open questions / assumptions

- **`class_relation_id` in the include builder**: included in v1 only if a
  straightforward selector is available; otherwise deferred (documented). Default
  assumption: defer unless trivially supported.
- **`meta.*` exact fields**: assumed to match the documented JSON envelope
  (`count`, `truncated`, `scope.{kind,class_id,object_id}`, `content_type`).
- **Relation-alias autocomplete in the standalone Template Library editor**: the
  template library is decoupled from any specific report's includes, so concrete
  alias completion only appears when editing within a report context that has
  includes configured; the library editor falls back to generic object-field
  completion. This is acceptable and intended.
