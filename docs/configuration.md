# Frontend configuration

Set these values on the process or container running the frontend. Use the
[Compose guide](quickstart-compose.md) for an evaluation deployment, or
[Helm](deployment.md) for a cluster.

| Setting | Purpose |
| --- | --- |
| `BACKEND_BASE_URL` | Required Hubuum API origin reachable from the frontend process/container. |
| `VALKEY_URL` | Required shared session store; Compose configures its bundled Valkey service. |
| `SESSION_TTL_SECONDS` | Session lifetime; the Compose default is 28,800 seconds. |
| `SESSION_PREFIX` | Valkey session key prefix; use a distinct prefix for separate installations. |
| `SETTINGS_PREFIX` | Prefix for compatibility settings cached in Valkey. |
| `NEXT_PUBLIC_APP_NAME` | Application display name. |

See the [environment template](../.env.example) and
[Compose environment template](../.env.quickstart.example) for their supported
settings. Restart the frontend after changing runtime configuration; public
Next.js build variables require rebuilding the application.

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
Use [observability](observability.md) for probes, logging, and request IDs.
