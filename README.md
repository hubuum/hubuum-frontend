# Hubuum Frontend

Next.js frontend scaffold for the Hubuum REST API, built for secure horizontal scaling in OKD.

## What is scaffolded

- Next.js (App Router) + TypeScript
- Server-side auth boundary (BFF pattern)
- Opaque Hubuum API token handling through server sessions
- Shared server-side session store via Valkey
- Catch-all API proxy route that injects `Authorization: Bearer <token>` server-side
- TanStack Query for snappy client-side data fetching
- OpenAPI generator wiring (`orval`) for typed client generation from `openapi.json`
- Biome-based linting (`npm run lint`)
- Baseline security headers (CSP, frame-ancestors, referrer policy, etc.)
- Multi-stage Dockerfile suitable for OKD deployments

## Architecture

Browser clients never receive backend tokens directly.

1. `POST /_hubuum-bff/auth/login` forwards credentials to Hubuum `/api/v0/auth/login`.
2. Hubuum returns an opaque token.
3. Frontend creates a session id (`hubuum.sid`) and stores token in Valkey under that key.
4. Browser gets only the `HttpOnly` session cookie.
5. Browser data requests go via `/_hubuum-bff/hubuum/<path>`.
6. Proxy reads session from Valkey and injects bearer token for upstream Hubuum request.

This keeps pods stateless and horizontally scalable. Any pod can serve any authenticated request as long as it can read the same Valkey instance.

## BFF route layout

The frontend owns only routes under `/_hubuum-bff/...`.

| Frontend route | Purpose |
| --- | --- |
| `/_hubuum-bff/auth/login` | Accepts browser login payloads, calls backend `/api/v0/auth/login`, and creates the frontend session cookie. |
| `/_hubuum-bff/auth/providers` | Discovers public authentication providers from backend `/api/v0/auth/providers`; the login form falls back to a manual identity-scope field when unavailable. |
| `/_hubuum-bff/auth/logout` | Logs out locally and asks the backend to revoke the current token. |
| `/_hubuum-bff/auth/session` | Readiness-friendly session check for the browser session. |
| `/_hubuum-bff/hubuum/<backend-path>` | Generic authenticated BFF proxy. For example, `/_hubuum-bff/hubuum/api/v1/classes` calls backend `/api/v1/classes` with the server-side bearer token. |
| `/_hubuum-bff/classes/...` | Frontend helper BFF routes that normalize a few class/object workflows before calling backend APIs. |
| `/_hubuum-bff/settings` | Reads and updates the current principal's durable console preferences through the backend settings API, with a temporary Valkey fallback for older servers. |

The frontend deliberately does not own `/api/v0/...` or `/api/v1/...`. This
lets a colocated reverse proxy route those paths directly to the backend while
sending browser/app traffic and `/_hubuum-bff/...` to the Next.js frontend.

Example edge routing shape:

```text
/api/v0/*        -> hubuum backend
/api/v1/*        -> hubuum backend
/_hubuum-bff/*  -> hubuum frontend
/*               -> hubuum frontend
```

The internal BFF prefix is intentionally fixed at `/_hubuum-bff`. Making it an
environment variable would have some upside, but the tradeoff is not attractive
for this app:

- **Pros:** deployments could choose a different external prefix without edge
  rewrite rules.
- **Cons:** Next.js App Router routes are filesystem-defined, so runtime env
  cannot actually move the server route files; client code, generated API URLs,
  route docs, CSP/proxy rules, health checks, and tests would all need to agree
  on one mutable value; misconfiguration could accidentally put BFF routes back
  under backend-looking paths.

If a site needs a different public prefix, prefer an edge/proxy rewrite from the
public prefix to the frontend's fixed `/_hubuum-bff/...` routes.

## Backend API access assumptions

Hubuum `/api/v0/meta/...` endpoints are admin-only. The frontend must only call
them after an admin access check, and current meta usage is limited to the
admin statistics surface and admin-only landing-page counts. The statistics
surface shows system counts, database state, and global task state.
Administrators also have a dedicated read-only Configuration page; the server
redacts secret values before returning the effective settings.

Task activity shown to regular users comes from `/api/v1/tasks` through the BFF
proxy, so users can see the task records available to their account without
requiring global meta access.

Cursor-paginated helper requests that do not display an exact total pass
`include_total=false`; primary data tables retain the default exact-count
behavior when they show `X-Total-Count` in pagination controls.

## Scoped identities

The login form accepts an optional identity scope. Blank values and `local`
select local Hubuum users; any other value is forwarded as `identity_scope` for
the matching configured authentication provider. After login, the BFF verifies
the issued token against `/api/v1/iam/me`. This prevents an older backend that
ignores the new field from accidentally authenticating a same-named local user.
When the public provider-discovery endpoint is available, the form presents its
scopes as a select menu. A missing, failed, or malformed discovery
response keeps the manual identity-scope field available for older servers.

Principal and group labels include their non-local scope where names can be
ambiguous. Provider-managed user profiles, groups, and synchronized group
memberships are read-only in the console. Users can still be assigned to local
groups, including users that originated from a provider.
Import permission selectors include `GroupKey.identity_scope`, and the import
workspace defaults omitted scopes to `local` to match the backend contract.

Service-account credentials expose the backend's two independent token-scope
dimensions. Permission scopes select allowed operations, while resource scopes
select collections, classes, and objects through unified name search. The
effective authority remains the intersection of the principal's live group
grants, the permission scope, and the resource scope. The admin creation flow
creates the account and its first scoped token together; later tokens use the
same guided scope controls on the account detail page. The owner group controls
who can manage a service account but does not grant runtime access, so the
account still needs live group membership before its token has effective
authority. Server `v0.0.4` represents both boundaries under one nullable
`scope` object, and token lists show the exact permission and resource
dimensions returned by the server. Selecting a listed token opens its complete
lifecycle metadata and every permission, collection, class, and object boundary.
Resource names are resolved beside their exact IDs without exposing the bearer
token or stored hash. A listed token can be cloned from its detail view: the
creation flow copies its exact permission and resource boundaries while using a
fresh expiry, including for expired tokens once the server returns them. Server
`v0.0.5` publishes its effective default token
lifetime and returns the authoritative expiry for each newly issued token. The
console shows that default beside optional expiry fields while leaving the
server responsible for materializing omitted expiries. Human users with an
unscoped session token can mint tokens for themselves from their Account page.
Human admins can mint for any principal, and human members of a service
account's owner group can manage its tokens from their Account page.
Service-account actors never receive token-minting controls, and disabled
service accounts cannot receive new tokens. Local group membership editors can
add either human users or service accounts by name, and each service-account
detail page lists its current runtime group memberships separately from its
owner group.

## Object data columns

The objects workspace can promote fields from each object's JSON `data` blob
into table columns. Candidate fields are discovered from the selected class
schema when available, then augmented from the currently loaded object rows.
Discovery is page-local and shallowly bounded, so it does not trigger an
expensive full-dataset scan.

Object creation stays scoped to the selected class. The default Data editor
combines schema fields with fields observed in sampled class objects, preloads
required schema fields, and offers raw JSON as an alternate synchronized tab.
Closed schemas hide arbitrary-field creation; permissive schemas expose it.

Column preferences are stored per user and per class id. The `Data columns`
menu lets users reset to suggested fields or clear all promoted columns. The
same menu can show or hide the raw data preview column, also remembered per
class id. Portable preferences such as light/dark mode, relative text size,
workspace atmosphere, pins, and selected data columns are saved in the user
settings store, with `localStorage` used as an owner-scoped browser cache. The
Appearance page offers four complete workspace atmospheres: Sunset, Golden
Hour, Clouds, and Forest. Each atmosphere owns its action, typography, canvas,
navigation, surface, and ambient palette in both light and dark mode. Viewport
and activity state such as table widths, sidebar state, recent items, and task
last-seen timestamps stay device-local.

The `Custom data fields` menu lets users create personal fallback columns with a
label and a `|`-separated list of data paths. The table shows the first
non-empty value, so a field like
`os.fedora.version|os.redhat.version|os.macos.version` can display one
normalized `OS version` column across differently shaped object data. Personal
display definitions are stored as per-user, per-class console preferences and
affect presentation only.

Hubuum Server computed fields are separate domain resources. A class page can
create and manage shared definitions for all class readers and personal
definitions stored for the current user. Definitions support typed aggregation
and presence operations over JSON Pointer paths, can be previewed against an
existing object or sample data, and shared values can be explicitly rebuilt.
Object reads opt in with `include=computed`; enabled shared and personal values
then appear as individually selectable, per-user object-table columns, in table
exports and loaded-page search, and on object detail pages. Evaluation errors
and stale shared materializations remain visible. With Hubuum Server `v0.0.3`,
computed columns can sort the complete server result and the Server filters menu
offers result-type-aware computed predicates, including null, numeric range,
JSON containment, and negated matching.

The objects workspace can group by an object, nested data, shared-computed, or
personal-computed field through the server's permission-aware aggregate
resource. Server filters run before aggregation, counts cover the complete
matching class rather than the loaded object page, and aggregate rows have
their own cursor pagination and exact total. Null, missing, and unavailable
computed values remain distinct. Personal custom fallback fields still use a
loaded-page grouping because their first-non-empty path expression is a console
display preference rather than a server field. With Server `v0.0.4`, the same
workspace can add up to four ordered `sum`, `average`, `min`, or `max` measures
over numeric JSON and computed fields, either per group or as one global
aggregate. Measure cells and exports retain contributing and skipped source
counts. The report template editor also includes runnable MiniJinja `groupby`
examples for report-specific grouping and grouped CSV output. Object tables,
ad-hoc exports, and object-scoped export templates share the same server-filter
field discovery, typed operators, validation, and backend query grammar for
object, nested JSON data, and computed fields.

## Bookmarkable reports

Saved executable export templates have stable, authenticated report URLs under
`/reports/{template_id}`. The frontend remembers the latest task for the
current session, template revision, and normalized set of run overrides. It
reuses that task while its backend output remains available; otherwise it
starts a new template export, waits for the task to finish, and remembers the
replacement. Concurrent requests for the same report join one generation
through a short Valkey lock instead of submitting duplicate tasks.

The backend output body is streamed with its original content type. The
response is not wrapped in console markup or parsed/reformatted, so saving the
browser page saves the generated template result itself. HTML report responses
receive a script-disabled sandbox policy because they are served from the
console origin.

Report responses include `Server-Timing` metrics for session access, template
revision lookup, report-cache access, task validation or submission, output
time to first byte, and total server time to response headers. Body transfer
and browser rendering happen after those measurements and are not included.

Bookmark URLs can supply the supported template-run overrides through `query`,
`object_id`, `missing_data_policy`, `max_items`, and `max_output_bytes` query
parameters. Related-object templates require `object_id`. Existing stored task
outputs use `/reports/runs/{task_id}` and are streamed through the same raw
response boundary. `HEAD` requests never generate reports, and frontend links
disable Next.js prefetching so merely rendering or hovering a link cannot start
a task. An optional `max_age` parameter limits how old a completed task may be:
whole numbers are seconds, and `s`, `m`, `h`, or `d` suffixes are accepted
(`max_age=15m`). `max_age=0` explicitly forces a new run. Updating the saved
template also causes the next request to generate a new report.

The default Reports tab is a catalog of executable saved reports, while less
common one-off JSON exports have their own top-level tab. `View` opens the
stable raw URL, `Refresh now` performs one forced generation, waits for the task
to finish without opening its output stream, and redirects to the clean
bookmark URL. `Run with changes` opens the authenticated configuration
interface at `/exports/reports/{template_id}`. That interface uses the same
visual query builder as template authoring and keeps freshness, missing-data,
and output-limit overrides available without putting controls inside the
generated result. Each catalog card distinguishes the template's update time
from the current saved-default export's generation time and stored-output
expiry without generating a report during inspection. Saved-query hints
translate filters and sorting into readable field, operator, and value
descriptions, and class-scoped reports identify their class. These changes
affect only the configured URL. The saved default query can be edited directly
from each catalog card's More menu. Permanent layout, scope, include, and other
template changes remain in
`/exports/templates/{template_id}`, while new definitions start under
`/exports/templates/new`. Adding `?from={template_id}` to the new-template URL
copies an existing definition into a separately named, unsaved template.

New template authoring starts with its name, purpose, and output format before
target, query, hydration, rules, and document design. HTML templates can use a
standard-page mode where authors edit only the body. The frontend stores that
body inside a deterministic full HTML template with title and viewport
metadata, print styling, responsive typography, and readable alternating table
rows. Advanced authors can instead own the complete HTML document. In both
modes the raw report route still streams the exact generated backend output;
it never injects console controls or response-time wrappers.

Server `v0.0.4` audit events, resource history, and task lifecycle events carry
durable provenance. The console shows the immediate actor, root initiator, and
originating task where available, and audit/subscription filters can match the
root initiator independently of the worker or system actor.

## Administrator backup and restore

The admin-only Backup & restore workspace creates server background tasks and
downloads their portable JSON output before the configured retention deadline.
Backups can include resource and audit history, and the UI exposes the server's
size, SHA-256, and expiry metadata.

Restore is a deliberately staged operation. Selecting a backup first uploads
and validates it without changing live data. The one-time restore capability is
kept only in component memory, never browser storage. Confirmation requires the
exact phrase `REPLACE ALL HUBUUM DATA` and a second danger dialog. A confirmed
restore replaces the complete Hubuum database, including identities and
permissions, and invalidates existing sessions and tokens.

The BFF uses `/api/v1/iam/me/settings` when the backend exposes the principal
settings API. Console preferences live under a versioned `hubuum_frontend`
namespace in the raw settings document, so recursive merge patches preserve
settings owned by other clients. While connected to an older backend, the BFF
uses Valkey without the session TTL. Existing fallback preferences are migrated
automatically when the backend endpoint becomes available.

Nested data fields use dotted display paths, while literal dots and backslashes
inside object keys are escaped:

```text
metadata.owner     -> nested { "metadata": { "owner": ... } }
metadata\.owner    -> literal key { "metadata.owner": ... }
path\\.segment     -> literal key { "path\\segment": ... }
```

On an object detail page, editable values in this flattened grid open a focused,
type-aware control when clicked. Enter saves that field immediately; Escape
closes the control without changing its value. Text, numbers, booleans, nulls,
empty objects, and empty arrays retain their JSON types unless the user
explicitly changes the type. Focused and data-only saves use guarded RFC 6902
JSON Patch operations, so unrelated concurrent data edits compose and a stale
value fails safely instead of being overwritten. `Edit data` also exposes `Add
field`, which accepts the same dotted/bracket path syntax and can create missing
object branches or append the next array item. `Edit as JSON` opens the raw
object data document directly, shows a structural change review, and turns
data-only saves into granular guarded patch operations. Read-only users get a
plain raw JSON view. Arrays are replaced atomically at their own path, and
unusually large edits fall back to a guarded whole-document replacement.

Directly editable values on object, class, and collection detail pages use the
same whole-field edit target instead of a separate pencil or Edit control. This
includes names, descriptions, collection selectors, schema validation, and JSON
schema. Opening one focuses its editor immediately, and Escape restores the
draft. Permission-gated hierarchy moves remain a separate collection operation.

Escape is the console-wide safe exit for transient work. It closes the most
recently opened menu, create form, or edit mode without saving its draft; nested
modes unwind one at a time. Escape is ignored while an inline save or delete is
in progress, so leaving the interface never implies that an active request was
canceled.

## Collection hierarchy

Collections are hierarchical. The frontend shows parent/path information in
collection lists, lets users create collections under a parent, and supports
moving non-root collections to another visible parent. The root collection
cannot be moved or deleted, and collections with direct children must have those
children moved or deleted before the collection can be deleted.

Collection permission management distinguishes direct rows from effective
permissions. Direct rows are editable on the collection detail page. Effective
permissions include inherited grants from ancestor collections and are shown as
read-only context for the current principal.

Collection names are unique among siblings, not globally. UI selectors prefer
path-aware labels where the API uses collection IDs. Import overrides still use
the backend's name-based `CollectionKey`, so the frontend blocks existing
collection overrides when multiple visible collections share the selected name.

## Quick start

Use Node.js 24 LTS. Install dependencies:

```bash
npm ci
```

Create an environment file:

```bash
cp .env.example .env.local
```

Set the required environment variables:

- `BACKEND_BASE_URL`: Hubuum API base URL
- `VALKEY_URL`: Valkey URL for server-side sessions; the example points to the
  local development dependency

Start the Valkey development dependency:

```bash
npm run dev:deps
```

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

The login page ships with Sunset, Mountains, Clouds, and Forest backgrounds. Sunset is
the first-run default, and the browser remembers a person's
selection on that device. Optional private login backgrounds belong in
`login-backgrounds/`. That directory's image files are ignored by Git and the
container build; the login page discovers them at runtime and adds both
individual choices and a Random choice. Compose mounts that directory
read-only. Helm deployments can provide the same runtime directory through
`loginBackgrounds.existingClaim`.

Stop the development dependency when finished:

```bash
npm run dev:deps:down
```

See [local development](docs/development.md) for backend URL examples,
dependency lifecycle details, and alternate Valkey ports. In particular,
`BACKEND_BASE_URL` must be reachable from the host process running Next.js.

For production-style local runs:

```bash
BACKEND_BASE_URL=http://localhost:7070 \
  VALKEY_URL=redis://127.0.0.1:6379/0 npm run build
BACKEND_BASE_URL=http://localhost:7070 \
  VALKEY_URL=redis://127.0.0.1:6379/0 npm start
```

### Container quickstart

The release Compose quickstart runs the frontend and Valkey against an existing
Hubuum Server. It does not install the backend or PostgreSQL:

```bash
cp .env.quickstart.example .env.quickstart
# Edit BACKEND_BASE_URL in .env.quickstart.
docker compose --env-file .env.quickstart -f compose.quickstart.yml up -d
```

See [the Compose quickstart](docs/quickstart-compose.md) for host networking,
updates, logs, and cleanup.

## Release artifacts

Current `main` development and Hubuum Frontend `v0.0.10` are validated against
Hubuum Server `v0.0.5`.
Releases provide:

- `ghcr.io/hubuum/hubuum-frontend:v0.0.10` for Linux AMD64 and ARM64;
- `oci://ghcr.io/hubuum/charts/hubuum-frontend:0.0.10`;
- a digest-pinned Compose quickstart archive and SHA-256 checksums; and
- build provenance and an image SBOM through GHCR attestations.

The application version is visible in the navigation, on the login page, and
in `/healthz` and `/readyz` responses. Release images show the exact tag (for
example, `v0.0.10`); commit images show `v0.0.10+<short-sha>`; unversioned local
builds show `v0.0.10+dirty`. Image builds may set the immutable identity with
`docker build --build-arg APP_VERSION=...`.

See [compatibility](docs/compatibility.md) and the
[maintainer release guide](docs/releasing.md). Release deployments should pin a
version or digest instead of using the moving `main` tag.

## Security audit gate

Run a production-only dependency audit:

```bash
npm run audit:prod
```

This checks runtime dependencies only (`npm audit --omit=dev`), so lint/codegen dev-tool advisories do not block deploys.
The CI workflow runs this gate together with lint, typecheck, unit tests,
backend compatibility tests, a production build, container smoke tests,
Compose validation, and Helm validation.

## Live backend contract tests

Run the frontend's live backend contract suite against the latest published
server image:

```bash
npm run test:live-backend
```

The script defaults to `ghcr.io/hubuum/hubuum-server:v0.0.5`, starts a
disposable Hubuum server and Postgres database through Docker Compose, waits for
`/readyz`, resets the default `admin` password inside the container, exercises
the auth, scoped and unscoped token mint/use/list/revoke lifecycles, permission,
redacted admin configuration, backup/restore staging, shared and personal
computed fields, events/audit, history/as-of, event sink, subscription, delivery
lifecycle, public token-lifetime discovery, authoritative token expiry,
client pagination discovery, by-name routes, object aggregation, computed
querying, JSON Patch, and pagination APIs directly, and tears the stack down.
Restore confirmation is intentionally excluded so this contract suite never
replaces the live test database.

Useful overrides:

- `HUBUUM_LIVE_BACKEND_IMAGE`: backend image to test, defaults to `ghcr.io/hubuum/hubuum-server:v0.0.5`
- `HUBUUM_LIVE_BACKEND_PORT`: host port for the live server, defaults to `9999`
- `HUBUUM_LIVE_POSTGRES_PORT`: host port for Postgres, defaults to `15432`
- `HUBUUM_LIVE_COMPOSE_PROJECT`: Compose project name, defaults to `hubuum-frontend-live-test`
- `HUBUUM_LIVE_KEEP_STACK=1`: leave the containers running for debugging

## OpenAPI generation

`openapi.json` is in repo root.

Generate typed clients:

```bash
npm run gen:api
```

Generated output goes to `src/lib/api/generated`.
The generator runs via `npx orval@8.23.0`, so network access is required when generating.

## Deployment notes (OKD)

- Every replica requires `VALKEY_URL` from a Secret so opaque sessions remain
  available across Next.js runtimes, restarts, and pods.
- Use `/healthz` for liveness and `/readyz` for dependency-aware readiness.
- Frontend-owned BFF routes live under `/_hubuum-bff/...`; `/api/v0/...`
  and `/api/v1/...` remain available for direct backend routing at the edge.
- Keep Valkey private to the application network and enable persistence or
  replication according to the deployment's session-availability needs.
- TLS terminate at ingress; keep secure cookies enabled in production.

## Container and Helm publishing

After all required checks pass, commits to `main` publish a moving container
image:

```text
ghcr.io/hubuum/hubuum-frontend:main
```

The workflow also publishes an immutable full-SHA tag for each commit.
Both tags are multi-architecture images for `linux/amd64` and `linux/arm64`.

The Helm chart lives in `charts/hubuum-frontend` and is published to GHCR as
an OCI chart with a unique prerelease chart version per `main` build. Tagged
releases publish a matching stable chart version. The chart defaults its image
tag from `appVersion` and also accepts an immutable `image.digest`.

Install from the published OCI chart:

```bash
helm install hubuum oci://ghcr.io/hubuum/charts/hubuum-frontend \
  --version 0.0.10 \
  --set backend.baseUrl=https://hubuum-api.example.com \
  --set valkey.existingSecret.name=hubuum-frontend-valkey
```

For OKD Routes, enable the chart route resource:

```bash
helm upgrade --install hubuum oci://ghcr.io/hubuum/charts/hubuum-frontend \
  --version 0.0.10 \
  --set backend.baseUrl=https://hubuum-api.example.com \
  --set route.enabled=true \
  --set route.host=hubuum.example.com
```

## Important caveat

The current Hubuum OpenAPI spec has many list endpoints that return arrays without explicit pagination/filter query params. For large datasets, frontend UX and backend load will benefit from adding pagination, filtering, and sort parameters to those endpoints.
