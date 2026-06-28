# Frontend adaptation for PR #94 — principals, scoped tokens, service accounts

**Date:** 2026-06-28
**Status:** Approved (design)
**Upstream:** [hubuum/hubuum#94](https://github.com/hubuum/hubuum/pull/94)
(merged) + [hubuum/hubuum#95](https://github.com/hubuum/hubuum/pull/95)
(`me_endpoints` branch, assumed to merge), spec in `docs/auth_model.md` on
`hubuum` main. The client is generated from the `me_endpoints` branch
`docs/openapi.json`, which is a superset of #94 + #95.

## Background

PR #94 reworks the backend identity model. Users are generalized into
**principals** (class-table inheritance) with two kinds: `human` and
`service_account`. The login/display name now lives on `principals.name` (there is
no `users.username` anymore). IAM routes are re-homed under `principals/*`, tokens
gain a full lifecycle with optional **scopes**, and **service accounts** become a
first-class non-human principal for automation.

The frontend's local `openapi.json` predates the merge and must be regenerated. The
field rename and endpoint moves are breaking — the app will not compile/run until
adapted.

## Goals

1. Adapt the frontend to the new principal-centric API so existing functionality
   works again (field rename + endpoint moves).
2. Add the new `proper_name` field as an editable profile field.
3. Add self-service ("me") surfaces: view own groups & effective permissions, and
   mint/list/revoke own tokens (with optional scopes).
4. Add service-account management (Admin → Service accounts): full lifecycle plus
   per-SA token management.

## Non-goals

- Re-enabling a disabled service account (no `enable` endpoint exists in this PR;
  disable is one-way).
- Adding service accounts to groups via the member-add autocomplete (membership
  mutation is admin-only and can be layered later; the member *list* will show both
  kinds).
- Separate nav gating for non-admin human owner-group members of service accounts
  (we rely on backend 403s).
- A name-match scan for the current principal (replaced by `GET /api/v1/iam/me`
  from PR #95).

## Reference: relevant API surface (from new `openapi.json`)

**Removed paths** (callers must migrate):
- `GET /api/v1/iam/users/{user_id}/tokens`
- `GET /api/v1/iam/users/{user_id}/groups`
- `POST|DELETE /api/v1/iam/groups/{group_id}/members/{user_id}`
- `GET /api/v1/namespaces/{namespace_id}/permissions/user/{user_id}`

**Added paths (PR #95 — self-service "me"):**
- `GET /api/v1/iam/me` → `MeResponse { principal: PrincipalMemberResponse, token: CurrentTokenMetadata }` (current principal id = `principal.principal_id`)
- `GET /api/v1/iam/me/tokens` → `PrincipalTokenMetadata[]`
- `GET /api/v1/iam/me/groups` → `Group[]`
- `GET /api/v1/iam/me/permissions` → `PrincipalNamespacePermissions[]`

> The `/me` endpoints replace the original plan's name-match scan for the current
> principal id and are the correct self-service surface (no admin/self ambiguity).
> Self token **mint/revoke** still go through `principals/{id}` using the id from
> `GET /me` (there is no `POST /me/tokens`).

**Added paths (PR #94):**
- `GET|POST /api/v1/iam/principals/{principal_id}/tokens`
- `POST /api/v1/iam/principals/{principal_id}/tokens/{token_id}/revoke`
- `GET /api/v1/iam/principals/{principal_id}/groups`
- `GET /api/v1/iam/principals/{principal_id}/permissions`
- `GET|POST /api/v1/iam/service-accounts`
- `GET|DELETE|PATCH /api/v1/iam/service-accounts/{service_account_id}`
- `POST /api/v1/iam/service-accounts/{service_account_id}/disable`
- `POST|DELETE /api/v1/iam/groups/{group_id}/members/{principal_id}`
- `GET /api/v1/namespaces/{namespace_id}/permissions/principal/{principal_id}`

**Key schema changes:**
- `UserResponse`: `username` → **`name`**; new optional **`proper_name`**.
- `LoginUser` / `NewUser`: `name` (+ `NewUser.proper_name`).
- `UpdateUser`: `email`, `password`, `proper_name` (no `name`; rename is via the
  principal, out of scope here).
- New: `NewServiceAccount` (`name`, `owner_group_id`, optional `description`),
  `ServiceAccountResponse` (`id`, `name`, `description`, `owner_group_id`,
  `disabled_at`, `created_at`, `updated_at`, `created_by`),
  `UpdateServiceAccount` (`description`, `owner_group_id`).
- New: `PrincipalMemberResponse` (`principal_id`, `kind`, `name`),
  `PrincipalToken` (mint response, includes raw `token` once),
  `PrincipalTokenMetadata` (list projection, hash-free, has `scoped`),
  `NewTokenRequest` (`name?`, `description?`, `expires_at?`, `scopes?: Permissions[]`),
  `PrincipalNamespacePermissions` (`namespace_id`, `namespace_name`, `grants[]`),
  `GroupGrant` (`group_id`, `groupname`, `permissions: Permissions[]`).
- `Permissions`: enum of 29 scope strings (the permission names).

**Scope semantics (fail-closed):** omit `scopes` ⇒ unscoped (full principal
authority); `scopes: [...]` ⇒ scoped to that set; `scopes: []` ⇒ **rejected 400**.
The UI must never send an empty array.

## Architecture

The BFF/proxy (`src/proxy.ts`) forwards `/api/*` by path with no allowlist, so new
routes flow through unchanged. The generated client (`src/lib/api/generated/`) is
committed and regenerated from `openapi.json` via `npm run gen:api`.

### Part A — Regenerate client

1. Replace `openapi.json` with the merged spec from `hubuum` main
   (`docs/openapi.json`).
2. Run `npm run gen:api` (orval + the prefix patch script).
3. Commit the regenerated client and models as a discrete step so later diffs are
   reviewable.

### Part B — Breaking-change adaptation

- **`username` → `name`** at every API-response read site: `account-profile`,
  `admin-users-table`, `admin-user-detail`, `admin-group-detail`,
  `namespace-detail`, `object-detail`, `task-detail`, `lib/use-current-user-id`.
- **Login**: `login-form` builds `LoginUser = { name, password }`; the BFF login
  route (`app/_hubuum-bff/auth/login/route.ts`) maps the posted `username` form
  field to `name` when constructing credentials. The visible "Username" label is
  kept. Session storage keeps its internal `username` key (it holds the principal
  name); no change to session/cookie code.
- **Endpoint moves**:
  - current-user groups (`namespace-detail`, `object-detail`, `admin-user-detail`)
    → `getApiV1IamPrincipalsByPrincipalIdGroups`.
  - group members add/remove (`admin-group-detail`) →
    `…GroupsByGroupIdMembersByPrincipalId`; member rows render
    `PrincipalMemberResponse` (`principal_id`, `kind`, `name`) with a kind badge.
  - namespace user-permission lookups → `…PermissionsPrincipalByPrincipalId`.
- **"me" resolution**: `use-current-user-id` is rewritten to call
  `GET /api/v1/iam/me` and return `me.principal.principal_id` (signature unchanged,
  so app-shell and account components are untouched). Self-service reads use the
  `/me/*` endpoints directly; self token mint/revoke use `principals/{me id}`.

### Part C — `proper_name`

Add an editable `proper_name` input to `account-profile`, `admin-user-detail`, and
the create-user form in `admin-users-table` (`NewUser.proper_name`). Include it in
the `UpdateUser` payload. Display continues to use `name`.

### Part D — Self-service "me" (`/account/*`)

New routes (with a shared sub-nav/tabs across account pages):

- `/account` — profile (existing) + `proper_name`; loads via `GET /me` (id) +
  `GET /api/v1/iam/users/{id}` (full record), not a full-list scan.
- `/account/tokens` — list own tokens via `GET /me/tokens`; mint/revoke via
  `principals/{me id}`.
- `/account/groups` — own groups via `GET /me/groups`.
- `/account/permissions` — effective permissions via `GET /me/permissions`.

**Reusable components** (shared with service-account detail):

- `ScopePicker` — a "Restrict to scopes" toggle (default **off ⇒ unscoped**). When
  on, grouped checkboxes of the 29 `Permissions` (grouped by resource family). The
  submit is disabled while on with zero selected, so the form never sends `[]`.
  Emits `scopes: Permissions[] | undefined`.
- `TokenMintForm` — name, description, optional `expires_at`, and `ScopePicker`;
  takes a `principalId`. Calls `POST principals/{id}/tokens`.
- `RawTokenReveal` — shows the raw token from the mint response once, with a copy
  button and a "shown only once" warning.
- `TokenList` — lists `PrincipalTokenMetadata` (name, description, issued,
  expires, last-used, `scoped` badge, revoked state) for a `principalId`, with a
  revoke action.
- `PrincipalPermissions` — renders `PrincipalNamespacePermissions[]` grouped by
  namespace then granting group.
- `lib/token-scopes.ts` — maps the `Permissions` enum into ordered resource-family
  groups (Collection, Class, Object, ClassRelation, ObjectRelation, Template,
  RemoteTarget) for the picker UI.

### Part E — Service accounts (Admin → Service accounts)

- `/admin/service-accounts` — list (`ServiceAccountResponse`) with owner-group and
  disabled state; create form (name, owner-group select, description).
- `/admin/service-accounts/[id]` — edit (`description`, `owner_group_id`),
  **disable** (one-way: confirm dialog + disabled banner), delete, plus token
  management (reuses `TokenList`/`TokenMintForm` with the SA's id), groups, and
  permissions (reuses `PrincipalPermissions`).
- New "Service accounts" link in the Admin nav section of `app-shell`, gated by the
  existing `canViewAdmin`.

## Error handling

Use `getApiErrorMessage`. Handle: 400 (empty scopes — prevented client-side, but
surfaced if it slips through), 403 (scoped/SA restrictions on IAM surfaces), 409
(minting a token for a disabled SA), and group-delete 409 (owned SAs) where group
deletion is exercised.

## Testing

- Vitest: `ScopePicker` payload logic (off ⇒ `undefined`, on+selection ⇒ array,
  on+empty ⇒ blocked/no submit) and `token-scopes` grouping completeness (all 29
  enum values appear exactly once).
- `npm test`, `npm run typecheck`, `npm run lint` all clean.

## Caveats

- **Disable is one-way** — no enable endpoint in this PR; the UI states this.
- Member-add autocomplete remains human-user-focused; member list shows both kinds.
- Service-account nav is admin-only; human owner-group members reach it via direct
  URL and rely on backend authorization.
