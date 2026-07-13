# Local development

The frontend development environment runs Next.js on the host and Valkey in a
small Docker Compose service. Hubuum Server is an external dependency and must
already be running somewhere reachable from the host.

## First-time setup

Install Node.js 24 LTS and Docker Compose, then install the project dependencies:

```sh
npm ci
cp .env.example .env.local
```

The project type-checks with TypeScript 7. Next.js still consumes the
TypeScript 6 programmatic API during its build, so `package.json` installs the
two official side-by-side aliases: `@typescript/native` provides the `tsc`
binary, while `typescript` points to the TypeScript 6 compatibility package.
Keep both aliases until Next.js supports the TypeScript 7 API directly.

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

Then start Next.js:

```sh
npm run dev
```

Open <http://localhost:3000>. Authenticated use requires both the configured
Hubuum Server and Valkey; `/readyz` reports whether both dependencies are ready.

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

Run the public accessibility, contrast, responsive-layout, and screenshot
checks without backend credentials:

```sh
npm run test:e2e:public
```

Authenticated dashboard and create-flow checks run when `E2E_USERNAME` and
`E2E_PASSWORD` are set. Point either suite at an already running frontend with
`PLAYWRIGHT_BASE_URL`, for example `http://127.0.0.1:3000`. Refresh intentional
local screenshot changes with `npm run test:e2e:update`; CI runs the portable
accessibility, contrast, and responsive-layout checks.

## Use another Valkey port

If port 6379 is already occupied, start the dependency on another loopback port
and update `.env.local` to match:

```sh
VALKEY_DEV_PORT=6380 npm run dev:deps
```

```dotenv
VALKEY_URL=redis://127.0.0.1:6380/0
```
