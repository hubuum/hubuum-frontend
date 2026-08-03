# Authenticated browser testing

The repository has two authenticated Playwright layers:

- focused authenticated smoke coverage intended for ordinary pull-request CI;
- the complete authenticated workspace suite, run on a schedule against a fully
  disposable Hubuum stack.

## Complete disposable suite

Run the complete suite with:

```sh
npm run test:e2e:authenticated:full
```

The command creates isolated Docker Compose projects for:

- Hubuum Server;
- PostgreSQL; and
- the Valkey-backed frontend session store.

It waits for server readiness, obtains a new password for the disposable
`admin` account, and passes that password directly to Playwright without
printing or writing it to disk. The Chromium suite runs with one worker so tests
that mutate the disposable server cannot race one another. The frontend itself
is started by the normal Playwright `webServer` configuration.

Both Compose projects and their volumes are removed when the command exits.
Set `HUBUUM_FULL_E2E_KEEP_STACK=1` while diagnosing a local failure. Recent
service logs are always copied to `test-results/full-authenticated/` before
cleanup.

## Overrides

The main overrides are:

```sh
HUBUUM_FULL_E2E_BACKEND_IMAGE=ghcr.io/hubuum/hubuum-server:main \
  npm run test:e2e:authenticated:full
```

```sh
HUBUUM_FULL_E2E_BACKEND_PORT=29999 \
HUBUUM_FULL_E2E_VALKEY_PORT=26379 \
  npm run test:e2e:authenticated:full
```

Project names can also be changed with
`HUBUUM_FULL_E2E_BACKEND_PROJECT` and `HUBUUM_FULL_E2E_VALKEY_PROJECT`.

## Scheduled workflow

`.github/workflows/authenticated-e2e.yml` runs the complete suite every night
against the pinned compatible Hubuum Server image. It can also be started
manually with an optional backend-image override. Failed runs retain the
Playwright report, traces, screenshots, videos, and disposable-service logs for
14 days.
