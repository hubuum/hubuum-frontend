# Frontend architecture

The frontend is a Next.js application with a server-side authentication boundary.
For installation, use the [Compose guide](quickstart-compose.md); for browser
workflows, use the [user guide](user-guide.md).

## Architecture

Browser clients never receive backend tokens directly.

1. `POST /_hubuum-bff/auth/login` forwards credentials to Hubuum `/api/v0/auth/login`.
2. Hubuum returns an opaque token.
3. Frontend creates a session id (`hubuum.sid`) and stores token in Valkey under that key.
4. Browser gets only the `HttpOnly` session cookie.
5. Browser data requests go via `/_hubuum-bff/hubuum/<path>`.
6. Proxy reads session from Valkey and injects bearer token for upstream Hubuum request.

When the backend rejects that bearer token with `401 Unauthorized`, the BFF
deletes the Valkey session and clears the browser cookie. Protected navigations
and client-side requests then return directly to `/login`, preserve the current
path in the `next` query parameter, and explain that the session expired. A
`403 Forbidden` response remains an in-place authorization error and does not
sign the user out.

This keeps pods stateless and horizontally scalable. Any pod can serve any authenticated request as long as it can read the same Valkey instance.

Application documents are dynamically rendered with a fresh CSP nonce. Production
scripts require that nonce or trust inherited from a nonce-authorized script;
development additionally permits evaluation for Next.js tooling. Runtime editor
and resizing styles still require inline styles. BFF responses are private and
must not be stored by shared caches. Active report content (HTML, XHTML, SVG) is
sandboxed without scripts or same-origin privileges on both report routes and the
generic proxy. Export warning and truncation headers remain visible to the UI.
Schema repair HTML may open object links in new tabs that do not inherit the
report sandbox; the report itself remains script-disabled and isolated.

Sign-out waits briefly for pending preference saves, then always attempts to end
the session. A failed sign-out keeps the workspace visible with a persistent error
and a retry instruction. Local logout proceeds even when backend token revocation
times out.

## BFF route layout

The frontend owns only routes under `/_hubuum-bff/...`.

| Frontend route | Purpose |
| --- | --- |
| `/_hubuum-bff/auth/login` | Accepts browser login payloads, calls backend `/api/v0/auth/login`, and creates the frontend session cookie. |
| `/_hubuum-bff/auth/providers` | Discovers public authentication providers from backend `/api/v0/auth/providers`; the login form falls back to a manual identity-scope field when unavailable. |
| `/_hubuum-bff/auth/logout` | Logs out locally and asks the backend to revoke the current token. |
| `/_hubuum-bff/auth/session` | Readiness-friendly session check for the browser session. |
| `/_hubuum-bff/hubuum/api/v1/restores/<id>/status` | Capability-authenticated restore status, available after database replacement invalidates bearer sessions. |
| `/_hubuum-bff/hubuum/<backend-path>` | Generic authenticated BFF proxy. For example, `/_hubuum-bff/hubuum/api/v1/classes` calls backend `/api/v1/classes` with the server-side bearer token. |
| `/_hubuum-bff/classes/...` | Frontend helper BFF routes that normalize a few class/object workflows before calling backend APIs. |
| `/_hubuum-bff/settings` | Reads and updates the current principal's durable console preferences through the backend settings API, with a temporary Valkey fallback for older servers. |
| `/_hubuum-bff/credential-mutations` | Confirms the current human's password and performs one credential mutation when the backend requires a fresh authentication approval. Approval secrets stay inside the BFF. |

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

Browser requests using `POST`, `PUT`, `PATCH`, or `DELETE` under the BFF prefix
must carry same-origin request metadata. The frontend accepts an exact matching
`Origin`, or `Sec-Fetch-Site: same-origin` when `Origin` is absent, and rejects
cross-origin, same-site sibling, and fully missing metadata before reading a
session or contacting Hubuum. TLS-terminating proxies must overwrite
`X-Forwarded-Proto` and `X-Forwarded-Host` with the public request values so the
frontend can compare the browser origin with the external console origin.

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

The Tasks workspace supports Server `v0.0.16` discovery filters for lifecycle,
time ranges, recorded resources and revisions, import/export/backup options,
output retention, and remote calls. Filters and sort order are stored in the URL
and preserved across cursor pages. The default scope is My tasks; All visible
tasks uses server authorization, and only administrators can filter another
submitter. Counts and table exports cover the current page. Task detail pages
show retained metadata for all six task kinds, distinguish unknown historical
values from false, and expose available output and schema-report links through
the BFF. Resource-specific filters require access to the referenced resource.

Task detail pages support cancellation with optional reasons, guarded queued
withdrawal, and polling until running work acknowledges cleanup. They show
execution deadlines, cancellation metadata, unattempted import items, and remote
dispatch evidence. Cancellation preserves already committed work according to the
task kind; remote effects may need reconciliation. Administrator Configuration
shows per-kind execution limits. See [compatibility](compatibility.md) for
Server `v0.0.15` authorization and upgrade requirements.

Cursor-paginated helper requests that do not display an exact total pass
`include_total=false`; primary data tables retain the default exact-count
behavior when they show `X-Total-Count` in pagination controls.
