# Local development

The frontend development environment runs Next.js on the host and Valkey in a
small Docker Compose service. Hubuum Server is an external dependency and must
already be running somewhere reachable from the host.

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

Open <http://localhost:3000>. Authenticated use requires both the configured
Hubuum Server and Valkey; `/readyz` reports whether both dependencies are ready.

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
the same digest-pinned Playwright 1.62.1 Noble `linux/amd64` image, bundled
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

The broader authenticated dashboard and create-flow checks run when
`E2E_USERNAME` and `E2E_PASSWORD` are set. Point either Playwright suite at an
already running frontend with `PLAYWRIGHT_BASE_URL`, for example
`http://127.0.0.1:3000`. CI runs the public functional checks, portable visual
comparisons, and disposable authenticated smoke flow as independent jobs.

## Use another Valkey port

If port 6379 is already occupied, start the dependency on another loopback port
and update `.env.local` to match:

```sh
VALKEY_DEV_PORT=6380 npm run dev:deps
```

```dotenv
VALKEY_URL=redis://127.0.0.1:6380/0
```
