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

1. `POST /api/auth/login` forwards credentials to Hubuum `/api/v0/auth/login`.
2. Hubuum returns an opaque token.
3. Frontend creates a session id (`hubuum.sid`) and stores token in Valkey under that key.
4. Browser gets only the `HttpOnly` session cookie.
5. Browser data requests go via `/api/hubuum/<path>`.
6. Proxy reads session from Valkey and injects bearer token for upstream Hubuum request.

This keeps pods stateless and horizontally scalable. Any pod can serve any authenticated request as long as it can read the same Valkey instance.

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
- Use readiness/liveness probes on `/login` or `/api/auth/session`.
- Do not rely on in-memory sessions in production.
- TLS terminate at ingress; keep secure cookies enabled in production.

## Important caveat

The current Hubuum OpenAPI spec has many list endpoints that return arrays without explicit pagination/filter query params. For large datasets, frontend UX and backend load will benefit from adding pagination, filtering, and sort parameters to those endpoints.
