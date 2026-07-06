# Hubuum Frontend

Next.js frontend scaffold for the Hubuum REST API, built for secure horizontal scaling in OKD.

## What is scaffolded

- Next.js (App Router) + TypeScript
- Server-side auth boundary (BFF pattern)
- Opaque Hubuum API token handling through server sessions
- Shared session store via Valkey (with dev fallback to in-memory)
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
| `/_hubuum-bff/auth/logout` | Logs out locally and asks the backend to revoke the current token. |
| `/_hubuum-bff/auth/session` | Readiness-friendly session check for the browser session. |
| `/_hubuum-bff/hubuum/<backend-path>` | Generic authenticated BFF proxy. For example, `/_hubuum-bff/hubuum/api/v1/classes` calls backend `/api/v1/classes` with the server-side bearer token. |
| `/_hubuum-bff/classes/...` | Frontend helper BFF routes that normalize a few class/object workflows before calling backend APIs. |

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
admin statistics surface and admin-only landing-page counts.

Task activity shown to regular users comes from `/api/v1/tasks` through the BFF
proxy, so users can see the task records available to their account without
requiring global meta access.

## Object data columns

The objects workspace can promote fields from each object's JSON `data` blob
into table columns. Candidate fields are discovered from the selected class
schema when available, then augmented from the currently loaded object rows.
Discovery is page-local and shallowly bounded, so it does not trigger an
expensive full-dataset scan.

Column preferences are stored in browser `localStorage` per class id. The
`Data columns` menu lets users reset to suggested fields or clear all promoted
columns. The same menu can show or hide the raw data preview column, also
remembered per class id.

The `Custom data fields` menu lets users create personal fallback columns with a
label and a `|`-separated list of data paths. The table shows the first
non-empty value, so a field like
`os.fedora.version|os.redhat.version|os.macos.version` can display one
normalized `OS version` column across differently shaped object data. These
custom definitions are currently stored per class id in browser `localStorage`;
system-wide admin-managed definitions need a backend settings endpoint before
they can be shared across users.

Nested data fields use dotted display paths, while literal dots and backslashes
inside object keys are escaped:

```text
metadata.owner     -> nested { "metadata": { "owner": ... } }
metadata\.owner    -> literal key { "metadata.owner": ... }
path\\.segment     -> literal key { "path\\segment": ... }
```

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Set required environment variables:

- `BACKEND_BASE_URL`: Hubuum API base URL
- `VALKEY_URL`: required for multi-pod production sessions

4. Run:

```bash
npm run dev
```

Open `http://localhost:3000`.

For production-style local runs:

```bash
BACKEND_BASE_URL=http://localhost:7070 npm run build
BACKEND_BASE_URL=http://localhost:7070 npm start
```

## Security audit gate

Run a production-only dependency audit:

```bash
npm run audit:prod
```

This checks runtime dependencies only (`npm audit --omit=dev`), so lint/codegen dev-tool advisories do not block deploys.
The CI workflow at `.github/workflows/ci.yml` runs this gate together with lint, typecheck, and build.

## Live backend contract tests

Run the frontend's live backend contract suite against the latest published
server image:

```bash
npm run test:live-backend
```

The script always pulls `ghcr.io/hubuum/hubuum-server:main`, starts a
disposable Hubuum server and Postgres database through Docker Compose, waits for
`/readyz`, resets the default `admin` password inside the container, exercises
the auth, permission, events/audit, history/as-of, event sink, subscription,
delivery lifecycle, and pagination APIs directly, and tears the stack down.

Useful overrides:

- `HUBUUM_LIVE_BACKEND_IMAGE`: backend image to test, defaults to `ghcr.io/hubuum/hubuum-server:main`
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
The generator runs via `npx orval@8.4.1`, so network access is required when generating.

## Deployment notes (OKD)

- Use at least 2 frontend replicas.
- Set `VALKEY_URL` in a Secret and mount as env var.
- Use readiness/liveness probes on `/login` or `/_hubuum-bff/auth/session`.
- Frontend-owned BFF routes live under `/_hubuum-bff/...`; `/api/v0/...`
  and `/api/v1/...` remain available for direct backend routing at the edge.
- Do not rely on in-memory sessions in production.
- TLS terminate at ingress; keep secure cookies enabled in production.

## Container and Helm publishing

Commits to `main` publish a moving container image:

```text
ghcr.io/hubuum/hubuum-frontend:main
```

The workflow also publishes an immutable SHA tag for each commit.
Both tags are multi-architecture images for `linux/amd64` and `linux/arm64`.

The Helm chart lives in `charts/hubuum-frontend` and is published to GHCR as
an OCI chart with a unique prerelease chart version per `main` build. The chart
defaults to the moving `main` image tag, so Kubernetes pulls the matching image
architecture for each node.

Install from the published OCI chart:

```bash
helm install hubuum oci://ghcr.io/hubuum/charts/hubuum-frontend \
  --version 0.0.1-main.<run-number> \
  --set env.BACKEND_BASE_URL=https://hubuum-api.example.com \
  --set existingSecret.name=hubuum-frontend
```

For OKD Routes, enable the chart route resource:

```bash
helm upgrade --install hubuum oci://ghcr.io/hubuum/charts/hubuum-frontend \
  --version 0.0.1-main.<run-number> \
  --set route.enabled=true \
  --set route.host=hubuum.example.com
```

## Important caveat

The current Hubuum OpenAPI spec has many list endpoints that return arrays without explicit pagination/filter query params. For large datasets, frontend UX and backend load will benefit from adding pagination, filtering, and sort parameters to those endpoints.
