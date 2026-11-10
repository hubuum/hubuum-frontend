# Frontend configuration

Set these values on the process or container running the frontend. Use the
[Compose guide](quickstart-compose.md) for an evaluation deployment, or
[Helm](deployment.md) for a cluster.

| Setting | Purpose |
| --- | --- |
| `BACKEND_BASE_URL` | Hubuum API origin reachable from the frontend process/container. Takes precedence over browser setup. Leave empty for setup. |
| `SETUP_KEY` | Random secret of 32–256 characters authorizing one-time browser setup. Required only until setup is complete. |
| `VALKEY_URL` | Required shared session store; Compose configures its bundled Valkey service. |
| `SESSION_TTL_SECONDS` | Session lifetime; the Compose default is 28,800 seconds. |
| `SESSION_PREFIX` | Valkey session key prefix; use a distinct prefix for separate installations. |
| `SETTINGS_PREFIX` | Prefix for installation configuration and compatibility settings in Valkey. Use a distinct prefix per installation. |
| `NEXT_PUBLIC_APP_NAME` | Application display name. |

See the [environment template](../.env.example) and
[Compose environment template](../.env.quickstart.example) for their supported
settings. Restart the frontend after changing runtime configuration; public
Next.js build variables require rebuilding the application.

## First-time connection setup

With no `BACKEND_BASE_URL` or saved connection, visiting the frontend opens
`/setup`. Keep `VALKEY_URL` configured and supply a randomly generated
`SETUP_KEY` through your deployment's secret mechanism. The operator enters
that key and the backend origin, selects **Check connection**, reviews the
detected version, then selects **Save and continue** to reach sign-in.
Without a setup key, the page explains how the operator can enable setup;
anonymous visitors cannot choose a backend.

The frontend checks `/readyz`, `/api-doc/openapi.json`, and `/api/v1/config`
from its own network. It verifies Hubuum's API identity, required session
operations, public configuration, and the supported release in
[compatibility](compatibility.md). Currently this is Server `v0.0.22`.
Optional `v` prefixes and build metadata are accepted; older/newer releases,
prereleases, Git development descriptions, and unknown versions are rejected.
Discovery follows no redirects and sends no credentials to the candidate.
The URL must be an HTTP(S) origin without credentials or `/api` paths.
Saving repeats validation before atomically creating the connection.

The connection applies to everyone and is stored without expiry at
`<SETTINGS_PREFIX>installation:backend` in Valkey. All replicas must share that
store and prefix. Enable Valkey persistence and retain its volume; the Compose
quickstart already does this. Ephemeral development Valkey forgets the choice
when stopped. Setup closes after the first successful save, and you can remove
`SETUP_KEY` and restart the frontend afterward.

An explicitly configured `BACKEND_BASE_URL` always wins and retains the existing
deployment-managed workflow. To change servers, update that environment value
and restart all frontend replicas. Clear the installation's sessions and user
settings when switching to a different installation; principal IDs and stored
preferences are server-specific. Newly created sessions are bound to their
backend origin and cannot be reused against another server. Browser setup
rejects legacy sessions that have no backend binding.

For Helm, set `backend.baseUrl: ""` and supply `SETUP_KEY` using `extraEnv`
with a `secretKeyRef`. No secret value needs to go into chart values.

## Proxy routing

Route `/api/v0/*` and `/api/v1/*` to Hubuum Server, and `/_hubuum-bff/*` plus
browser routes to the frontend. The BFF prefix is fixed. TLS-terminating proxies
must overwrite `X-Forwarded-Proto` and `X-Forwarded-Host` with the public request
values. See the [authentication boundary](architecture.md#bff-route-layout)
for origin checks and session handling.

## Login backgrounds

The frontend includes Sunset, Mountains, Clouds, and Forest. A person's browser
remembers their selection. Optional AVIF, JPEG, PNG, and WebP files are loaded
from `login-backgrounds/` at runtime and remain outside the image.

Compose mounts that directory read-only. Set `LOGIN_BACKGROUNDS_HOST_DIR` in
`.env.quickstart` to use another host directory. Helm can mount a read-only PVC
through `loginBackgrounds.existingClaim` at `/app/login-backgrounds`.

## Readiness and operations

`/healthz` checks the frontend process; `/readyz` also checks dependencies.
Before setup, healthy Valkey permits a `200` response with
`status: "setup_required"` and `backend: "not_configured"`, allowing ingress
traffic to reach setup. After setup, readiness requires both dependencies.
Use [observability](observability.md) for probes, logging, and request IDs.
