# AGENTS.md

This file applies to the entire repository. It is the working guide for coding
agents contributing to Hubuum Frontend.

## Project overview

Hubuum Frontend is a Next.js App Router application written in strict
TypeScript. It is the browser console for Hubuum Server and uses a backend-for-
frontend (BFF) security boundary:

- Backend bearer tokens stay on the server and are stored in Valkey-backed
  sessions.
- The browser receives only the `HttpOnly` `hubuum.sid` cookie.
- Browser API calls go through the fixed `/_hubuum-bff/...` prefix.
- Next.js pages and route handlers run alongside React client components; do
  not blur that boundary when moving code.

Read `README.md` before changing authentication, API routing, collections,
settings, pagination, or deployment behavior. Read `docs/development.md` before
running the application locally.

## Toolchain and setup

- Use Node.js 24 LTS; `package.json` requires Node `>=24.0.0`.
- Use npm and keep `package-lock.json` in sync with dependency changes.
- Install reproducibly with `npm ci`.
- Copy `.env.example` to `.env.local` for local development. Never commit,
  print, or overwrite a developer's `.env.local`.
- `BACKEND_BASE_URL` and `VALKEY_URL` are required at runtime. The backend URL
  must be reachable from the host process running Next.js.
- Start and stop the local Valkey dependency with `npm run dev:deps` and
  `npm run dev:deps:down`; run Next.js with `npm run dev`.
- Keep both TypeScript aliases in `package.json`: `@typescript/native` provides
  the TypeScript 7 `tsc` binary, while `typescript` supplies the TypeScript 6
  programmatic API currently required by Next.js.

Do not edit generated or transient directories such as `node_modules/`,
`.next/`, `playwright-report/`, or `test-results/`.

## Repository map

- `src/app/`: App Router pages, layouts, health routes, and BFF route handlers.
- `src/app/(protected)/`: authenticated application routes. Pages should keep
  their server-side session/admin guards.
- `src/app/%5Fhubuum-bff/`: the filesystem representation of the fixed
  `/_hubuum-bff` routes. Do not rename this directory or move these routes under
  `/api`.
- `src/components/`: interactive workspaces and reusable React components.
- `src/lib/auth/`: server-side session, principal, and authorization logic.
- `src/lib/api/`: hand-written backend/frontend helpers and domain API logic.
- `src/lib/api/generated/`: Orval-generated client and models; never edit these
  files by hand.
- `src/lib/*.test.ts`: Vitest unit tests. Vitest currently discovers
  `src/**/*.test.ts`, not `*.test.tsx`.
- `tests/e2e/`: Playwright accessibility, responsive, visual, and authenticated
  browser tests.
- `openapi.json` and `orval.config.mjs`: source contract and API generator
  configuration.
- `scripts/`, `compose*.yml`, `Dockerfile`, and `charts/`: development,
  compatibility, packaging, and deployment tooling.

## Implementation rules

### TypeScript and React

- Keep TypeScript strict. Avoid `any`; validate or narrow data received at
  runtime when the contract is not guaranteed.
- Use the `@/*` alias for imports from `src/` and follow the surrounding import
  ordering and tab-based formatting.
- Prefer Server Components. Add `"use client"` only when a component needs
  hooks, event handlers, browser APIs, or client-side TanStack Query behavior.
- Keep route-level authentication on the server with the existing guards.
  Client-side redirects or hidden controls are not authorization boundaries.
- Extract deterministic business logic into `src/lib/` and cover it with a
  colocated Vitest test instead of burying it in a large client component.
- Reuse the existing pagination, table, dialog, confirmation, toast, settings,
  and query helpers before introducing another abstraction.

### API and security boundary

- Never expose a Hubuum bearer token, Valkey connection information, or other
  server secret to client code, public environment variables, logs, or browser
  storage.
- Keep server-only modules marked with `import "server-only"` where applicable.
- Browser requests to Hubuum must use the BFF. Build frontend paths with the
  helpers in `src/lib/api/frontend.ts` instead of duplicating the prefix.
- Preserve correlation IDs through route handlers and backend calls. Log only
  safe/redacted request paths; never log credentials, tokens, cookies, or
  sensitive request bodies.
- Preserve the fixed routing split: the frontend owns `/_hubuum-bff/*`, while
  `/api/v0/*` and `/api/v1/*` belong to the backend at the edge.
- Treat `/api/v0/meta/*` as admin-only and perform the server-side admin check
  before calling those endpoints.
- Preserve deliberate compatibility behavior unless the task explicitly
  changes the supported backend contract. Examples include provider-discovery
  fallback, settings fallback/migration, and optional newer admin endpoints.
- Use generated request/response types where available. Follow neighboring
  code for status checks, `credentials: "include"`, pagination headers, and
  user-facing error extraction.
- Requests that do not display an exact total should pass
  `include_total=false`; primary paginated tables may retain exact totals.

### Generated API client

- Treat `openapi.json` as the source of truth for generated API types.
- After changing the OpenAPI document, run `npm run gen:api` and commit the
  resulting `src/lib/api/generated/` changes together with the contract.
- Generation uses pinned Orval 8.21.0 through `npx` and requires network access.
- The generation command also applies the repository's BFF-prefix patch. Do not
  reproduce that patch with manual edits to generated files.

### User interface and accessibility

- Match the established visual language in `src/app/globals.css` and existing
  components before adding new global styles or controls.
- Preserve keyboard navigation, visible focus, semantic labels, dialog focus
  behavior, touch target sizing, responsive layouts, and light/dark theme
  support.
- Prefer role- or label-based Playwright selectors over implementation-specific
  selectors.
- Update screenshot baselines only for intentional visual changes, using
  `npm run test:e2e:update`, and review the resulting images before keeping
  them.

## Verification

Run the smallest relevant check while iterating, then expand verification based
on the risk of the change.

- Focused unit test: `npm test -- src/lib/<name>.test.ts`
- All unit tests: `npm test`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Production build: `npm run build`
- Public accessibility/responsive checks: `npm run test:e2e:public`
- Full Playwright suite: `npm run test:e2e`
- Production dependency audit: `npm run audit:prod`
- Live backend contract suite: `npm run test:live-backend`

For ordinary TypeScript changes, run lint, typecheck, and relevant unit tests.
Also run the production build when changing routes, server/client boundaries,
configuration, or build behavior. Run the relevant Playwright tests for user-
visible interaction or layout changes. The live backend suite requires Docker
and is appropriate for BFF, authentication, API-contract, and compatibility
changes rather than every local edit.

If a required check cannot run because credentials, Docker, a browser, network
access, or a live backend is unavailable, report that explicitly; do not claim
the check passed.

## Change discipline

- Inspect the working tree before editing and preserve unrelated user changes.
- Keep changes scoped to the request. Do not perform opportunistic dependency
  upgrades, broad rewrites, or generated-file cleanup.
- Add or update tests for behavior changes and bug fixes when a practical test
  seam exists.
- Update `README.md`, files under `docs/`, `.env.example`, or deployment assets
  when their documented contract changes.
- Do not create commits, push branches, change releases, or update screenshot
  baselines unless the user explicitly asks or the task clearly requires it.
- In the handoff, summarize changed behavior, list verification actually run,
  and call out remaining risks or unverified paths.
