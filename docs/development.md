# Local development

The frontend development environment runs Next.js on the host and Valkey in a
small Docker Compose service. The standard workflow below uses an external
Hubuum Server reachable from the host.

For an isolated server with a freshly restored test corpus, run
`npm run dev:sandbox -- --pr 411`. It starts the dependencies and frontend and
prompts for a `corpus-admin` password. See the [sandbox guide](local-sandbox.md)
for tag/SHA/PR selection, keeping and resuming data, and
[resetting sandbox user passwords](local-sandbox.md#set-or-reset-user-passwords).
This workflow does not require `dev:deps` or edits to `.env.local`.

## First-time setup

Install Node.js 24 LTS and Docker Compose or Podman with a Compose provider,
then install the project dependencies:

```sh
npm ci
cp .env.example .env.local
```

The project type-checks with TypeScript 7. Next.js still consumes the
TypeScript 6 programmatic API during its build, so `package.json` installs the
two official side-by-side aliases: `@typescript/native` provides the `tsc`
binary, while `typescript` points to the TypeScript 6 compatibility package.
Keep both aliases until Next.js supports the TypeScript 7 API directly.
Vitest's configuration stays in `vitest.config.mjs` so Vite's native config
loader treats it as ESM without changing either TypeScript alias.

Edit `.env.local` and set `BACKEND_BASE_URL` to the Hubuum Server URL that the
host-side Next.js process can reach:

```dotenv
BACKEND_BASE_URL=http://127.0.0.1:8080
VALKEY_URL=redis://127.0.0.1:6379/0
```

`BACKEND_BASE_URL` is not resolved from inside `compose.dev.yml`. If Hubuum
Server runs in another container, publish its HTTP port to the host and use that
published address. A Compose-only service name such as `http://hubuum:8080`
will not resolve from `npm run dev`. A remote HTTPS Hubuum Server URL also works
when it is reachable from the development machine.

Restart Next.js after changing `.env.local`.

## Start

For a foreground session against an existing backend, use the wrapper after
`npm ci`:

```sh
BACKEND_BASE_URL=https://your-hubuum-server.example.com PORT=4444 ./run.sh
```

Open <http://127.0.0.1:4444> and sign in with your backend credentials. Use the
backend base URL without `/api/v1`. The wrapper starts a private Valkey Compose
project on an automatically assigned loopback port. Ctrl-C, termination, startup
failure, or frontend exit stops its child processes and removes that project's
container, network, and volumes. Existing development services and `.env.local`
are left alone; installed dependencies, cached images, and Next.js build caches
are retained.

`PORT` defaults to 3000. Options are forwarded to the usual development launcher:

```sh
BACKEND_BASE_URL=https://your-hubuum-server.example.com ./run.sh --port 4444 --listen 127.0.0.1
./run.sh --help
```

Docker or Podman with a Compose provider is required. `HUBUUM_CONTAINER_RUNTIME`
selects the runtime, and `VALKEY_DEV_PORT` can request a specific local Valkey
port. Stop any existing Next.js dev server in this checkout before using the
wrapper; Next.js permits one development server per checkout.

To manage the services separately, use the commands below.

Start the Valkey session store and wait for it to become healthy:

```sh
npm run dev:deps
```

The launcher waits for Valkey to answer `PING`; it does not require Compose's
Docker-specific `--wait` option. It uses `docker` when available (including the
Podman Docker interface), otherwise `podman`. Set
`HUBUUM_CONTAINER_RUNTIME=podman` to select Podman explicitly, and use the same
setting for `npm run dev:deps:down`. `HUBUUM_VALKEY_PROJECT` optionally selects an
isolated Compose project. Writable Valkey directories remain temporary memory
mounts with persistence disabled.

Then start Next.js:

```sh
npm run dev
```

Open <http://127.0.0.1:3000>. Authenticated use requires both the configured
Hubuum Server and Valkey; `/readyz` reports whether both dependencies are ready.

Local development and production launchers default to `127.0.0.1:3000` to avoid
differences in IPv4/IPv6 resolution of `localhost`. Choose
another port or listen address with npm's `--` argument separator:

```sh
npm run dev -- --port 4000 --listen 127.0.0.1
npm run dev -- --port=4000 --listen='*'
# After npm run build:
npm start -- --port 4000 --listen localhost
```

`--listen '*'` binds all IPv4 interfaces; quote the asterisk so the shell does
not expand it into filenames. IPv6 addresses such as `::1` (loopback) or `::`
(all IPv6 interfaces) are accepted, with or without brackets. `--hostname`/`-H`
remain aliases for `--listen`, and `-p` is an alias for `--port`.

An explicit `--port` overrides the process environment's `PORT`. Set `PORT`
before launching, not in `.env.local`. Local launchers ignore inherited
`HOSTNAME` values and use `--listen` for the bind address. Container images keep
their explicit `PORT`/`HOSTNAME` settings. Other Next.js development options,
such as `--webpack`, are forwarded unchanged. Use `--help` to see the options.

Sunset, Mountains, Clouds, and Forest are bundled login backgrounds, with Sunset used
on a device that has not selected one yet. Private login
artwork can be placed in the repository's `login-backgrounds/` directory.
AVIF, JPEG, PNG, and WebP files are discovered on each login-page request,
remain ignored by Git, and appear under Appearance in the background selector with a Random
choice.

## Stop

Stop Next.js with `Ctrl-C`, then remove the development Valkey container and
network:

```sh
npm run dev:deps:down
```

The development Valkey data is intentionally ephemeral, so stopping it signs
out existing local sessions.

## Browser quality checks

Install the browser used by the end-to-end suite once:

```sh
npx playwright install chromium
```

Run the public accessibility, contrast, and responsive-layout checks without
backend credentials:

```sh
npm run test:e2e:public
```

Pixel comparisons run separately in CI so an intentional or accidental visual
change does not hide the functional results. Both CI and baseline updates use
the same digest-pinned Playwright 1.63.0 Noble `linux/amd64` image, bundled
Chromium, and the fixed `v0.0.0+visual` display version. Docker is required to
refresh intentional baselines (Apple-silicon hosts run the image through Docker
emulation):

```sh
npm run test:e2e:update
```

Review every changed PNG under `tests/e2e/__screenshots__/` before committing
it. Do not update baselines with host-installed browsers because their font and
graphics stacks are not the supported baseline environment. The tablet
assertions allow a narrow 1.5% pixel tolerance for stable runner-CPU text
antialiasing; the other viewports retain the stricter 1% tolerance.

Run login, session, logout, keyboard interaction, resource-picker, accessibility,
and authenticated screenshot checks against disposable Hubuum Server and Valkey
containers:

```sh
npm run test:e2e:authenticated
```

The command resets the disposable `admin` password immediately before the test,
keeps it only in the child-process environment, and removes the containers and
volumes afterward. Override the pinned compatibility image with
`HUBUUM_AUTH_E2E_BACKEND_IMAGE` when testing another server build.

The default test target is released Server `v0.0.18`. To focus on schemas and
task cancellation:

```sh
npm run test:credential-fixtures
npm run test:live-backend
npm run test:e2e:authenticated -- --grep 'schema workspace|task cancellation'
```

The contract run requires schema evolution, saved diagnostics and HTML reports,
task cancellation, per-kind deadlines, and backup format 8. Browser checks cover
the guided schema flow, conflicts, reports, accessible pagination, cancellation
acknowledgement, authorization failures, and mobile layout after a real login.
CI pins the release digest listed in `docs/compatibility.md`. The scheduled
backend-main workflow continues checking future server builds separately.

`npm run test:e2e:authenticated:full` runs the complete authenticated suite,
then the live credential approval and restore checks on the same disposable
stack. Release readiness requires both to pass against Server `v0.0.18`.
Restore runs last because it replaces the database and invalidates tokens.
When explicitly testing an older backend image, set
`HUBUUM_FULL_E2E_CREDENTIAL_APPROVALS=legacy` to verify its original mutation flow.

The broader authenticated dashboard and create-flow checks run when
`E2E_USERNAME` and `E2E_PASSWORD` are set. Point either Playwright suite at an
already running frontend with `PLAYWRIGHT_BASE_URL`, for example
`http://127.0.0.1:3000`. CI runs the public functional checks, portable visual
comparisons, and disposable authenticated smoke flow as independent jobs.

## Credential approval compatibility checks

`npx playwright test tests/e2e/credential-approvals.spec.ts` checks optional
password prompting, cancellation, accessibility, responsive layout, and legacy
responses without backend credentials.

`tests/e2e/credential-approvals-live.spec.ts` is an explicit opt-in test against a
disposable backend and an already running frontend. Set `PLAYWRIGHT_BASE_URL`,
`E2E_USERNAME=admin`, and capture `E2E_PASSWORD` in memory using the disposable
container's `hubuum-admin --reset-password admin` immediately before each run.
Set `E2E_CREDENTIAL_APPROVALS=required` for Server `v0.0.16` or newer, or `legacy`
for a server without it, then run:

```sh
npx playwright test tests/e2e/credential-approvals-live.spec.ts --workers=1
```

These checks create credentials and imports. On a fully disposable stack only,
`E2E_CREDENTIAL_RESTORE=1` also verifies backup, approved restore confirmation,
and capability-authenticated polling through completion. Live credential tests
disable traces, screenshots, and video so secrets are not recorded in artifacts.

## Use another Valkey port

If port 6379 is already occupied, start the dependency on another loopback port
and update `.env.local` to match:

```sh
VALKEY_DEV_PORT=6380 npm run dev:deps
```

```dotenv
VALKEY_URL=redis://127.0.0.1:6380/0
```

### Forward server compatibility

The live contract suite defaults to the pinned Server `0.0.18` contract. Set
`HUBUUM_LIVE_EXPECT_SERVER_VERSION` when verifying a specific release candidate.
The scheduled backend-main job sets `HUBUUM_LIVE_FORWARD_COMPATIBILITY=1` to
exercise the complete contract across server version bumps; required release CI
retains its exact version check. Credential fixtures obtain approval only after
`reauthentication_required`, preserving the bearer, body, expiry precision, and
request guards. Older servers need no approval endpoint.

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

The script defaults to `ghcr.io/hubuum/hubuum-server:v0.0.18`, starts a
disposable Hubuum server and Postgres database through Docker Compose, waits for
`/readyz`, resets the default `admin` password inside the container, exercises
the auth, scoped and unscoped token mint/use/list/revoke lifecycles, permission,
redacted admin configuration, backup staging and isolated asynchronous restoration, shared and personal
computed fields, events/audit, history/as-of, event sink, subscription, delivery
lifecycle, public token-lifetime discovery, authoritative token expiry,
client pagination discovery, by-name routes, object aggregation, computed
querying, JSON Patch, and pagination APIs directly, and tears the stack down.
The final check confirms a restore only against the disposable stack owned by
the test wrapper, then verifies completion and invalidation of the old token.
Restore confirmation is skipped when targeting an externally supplied backend URL.

Useful overrides:

- `HUBUUM_LIVE_BACKEND_IMAGE`: backend image to test, defaults to `ghcr.io/hubuum/hubuum-server:v0.0.18`
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
The generator runs via `npx orval@8.39.0`, so network access is required when generating.

## Documentation-only CI

Pull requests and pushes containing only prose or documentation-site inputs run
Markdown lint and documentation validation without the application test/build
matrix. Unknown files, source changes, executable examples, and declared
test/build inputs retain application CI. Mixed changes run both kinds of checks.

`scripts/ci-policy.py` owns the allowlist and exceptions. Update its regression
tests whenever a document becomes a build, test, or packaging input; direct
literal Rust includes are checked automatically. Run the policy tests with
`python3 scripts/test-ci-policy.py`.

The `validate` check is the aggregate CI gate: classification failures,
failed checks, and unexpectedly skipped required jobs fail it. Keep that check
required in branch protection. Add the `ci:full` pull-request label or dispatch
the CI workflow manually to request complete validation. Release validation
and separately scheduled checks retain their existing coverage.

## Build identity

The **About Hubuum** page (`/about`) shows the frontend version and the connected
server's reported version. Open it from the account menu, the navigation version,
or **Go to…**. It is available to all signed-in users. Server discovery reads the
running server's public `/api-doc/openapi.json` on the frontend server; it does
not use admin metadata or the bundled API contract. If discovery fails, About
still shows the frontend version and marks the server version unavailable.
Older servers may report only their package release number.

The frontend version also appears in the navigation, on the login page, and in
`/healthz` and `/readyz` responses. Local and CI builds use
`git describe --tags --match 'v[0-9]*' --always --dirty`: a clean release is
`v0.0.13`; 16 commits after it is `v0.0.13-16-g256d59b`; uncommitted tracked
changes append `-dirty`. Without a reachable release tag, Git reports the commit
ID. Without Git metadata, builds show the package version with `+unknown`.

`NEXT_PUBLIC_APP_VERSION` can override the build identity. Container contexts
exclude `.git`, so pass the identity from the host checkout:

```sh
docker build --build-arg APP_VERSION="$(node scripts/print-application-version.mjs)" .
```

CI fetches release tags and history before resolving this value. Release images
continue to embed their exact release tag. The version is fixed at build time.

See [compatibility](compatibility.md) and the
[maintainer release guide](releasing.md). Release deployments should pin a
version or digest instead of using the moving `main` tag.
