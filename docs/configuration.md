# Frontend configuration

Set these values on the process or container running the frontend. Use the
[Compose guide](quickstart-compose.md) for an evaluation deployment, or
[Helm](deployment.md) for a cluster.

| Setting | Purpose |
| --- | --- |
| `BACKEND_BASE_URL` | Hubuum API origin reachable from the frontend process/container. Takes precedence over browser setup. Leave empty for setup. |
| `SETUP_KEY` | Optional random secret of 32–256 characters authorizing one-time browser setup. If omitted, the frontend generates and prints a one-time key at startup. |
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
`/setup`. Keep `VALKEY_URL` configured. The frontend generates a random 256-bit
setup key and prints it to stdout with the `[hubuum-setup]` prefix. Enter that
key and the backend origin, select **Check connection**, review the detected
version, then select **Save and continue** to reach sign-in.

The generated key is shared by all replicas through Valkey and printed again
on startup until setup completes. Saving the connection atomically consumes
the key; it is never printed after setup. Anyone with access to that startup
output can perform setup while the installation is unconfigured. Keep those
logs private. For deployments where secrets must not enter logs, supply your
own `SETUP_KEY` through a secret manager; explicit keys are never printed.
The setup page and API never disclose either kind of key.

The frontend checks `/readyz`, `/api-doc/openapi.json`, and `/api/v1/config`
from its own network. It verifies Hubuum's API identity, required session
operations, public configuration, and the supported release in
[compatibility](compatibility.md). Currently this is Server `v0.0.22`.
Optional `v` prefixes and build metadata are accepted. Other releases,
prereleases, Git development descriptions, and unknown versions show
**Compatibility not verified** and require an explicit **continue anyway**
confirmation. Stock servers older than `v0.0.20` lack the required rotating
authentication contract. These and servers advertising missing session
operations show **Known compatibility problems**, but may also be selected
after confirmation to allow patched installations. An override does not make
the frontend compatible; individual features or sign-in may still fail.
An unreachable server or an unrecognizable Hubuum API cannot be selected.
Discovery follows no redirects and sends no credentials to the candidate.
The URL must be an HTTP(S) origin without credentials or `/api` paths.
Saving repeats validation before atomically creating the connection. Changed
warnings or a changed version require fresh confirmation.

The connection applies to everyone and is stored without expiry at
`<SETTINGS_PREFIX>installation:backend` in Valkey. All replicas must share that
store and prefix. Enable Valkey persistence and retain its volume; the Compose
quickstart already does this. Ephemeral development Valkey forgets the choice
when stopped. Setup closes after the first successful save, and you can remove
`SETUP_KEY` and restart the frontend afterward.

## Changing the connection

Administrators can open **Configuration → Connection** to change a saved
target. The form checks the candidate and requires confirmation that the
change affects everyone and requires sign-in again. **Effective configuration**
remains the first and default tab. Setup keys are not used for later changes;
the BFF checks administrator access against the current server.

Each switch receives a new connection revision, invalidating existing frontend
sessions even when switching back to a previous origin. Backend credentials
remain bound to their original connection. Browser preferences and pending
settings updates are cleared when the browser next loads the new connection;
fallback settings in Valkey are isolated by connection. The backend's own
account settings remain on that backend.

An explicitly configured `BACKEND_BASE_URL` always wins. Its Connection tab
is read-only; change the environment value and restart all frontend replicas.
This also provides operator recovery if a saved target is unavailable or
cannot authenticate an administrator. To restore browser management, repair
the saved target at `<SETTINGS_PREFIX>installation:backend` while the frontend
is stopped, or remove it to repeat setup, then remove the environment override.
Preserve the settings prefix and persistent Valkey volume during upgrades.
When changing environment-managed deployments, clear installation sessions and
fallback user settings; the legacy environment-managed settings namespace is
preserved for existing deployments.

For Helm, set `backend.baseUrl: ""`. Optionally supply `SETUP_KEY` using
`extraEnv` with a `secretKeyRef` to avoid printing a generated key.

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
