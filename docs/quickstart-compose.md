# Frontend Compose quickstart

This quickstart runs Hubuum Frontend and Valkey. It does not install Hubuum
Server or PostgreSQL; point it at an existing Hubuum Server instance.

## Requirements

- Docker Compose 2.20 or newer, or a compatible Podman Compose installation.
- A Hubuum Server URL reachable from inside the frontend container.

## Start

Download `hubuum-frontend-v0.0.19-compose.tar.gz` and `SHA256SUMS` from
[release v0.0.19](https://github.com/hubuum/hubuum-frontend/releases/tag/v0.0.19).
The archive contains Compose configuration and its environment template, with
the frontend image pinned to a digest. In the download directory, verify and
extract it (on macOS, use `shasum -a 256 -c SHA256SUMS`):

```sh
sha256sum -c SHA256SUMS
tar -xzf hubuum-frontend-v0.0.19-compose.tar.gz
cd hubuum-frontend-v0.0.19-compose
```

If you are reading this file inside the extracted archive, start here:

```sh
cp .env.quickstart.example .env.quickstart
mkdir -p login-backgrounds
```

Edit `.env.quickstart` and set `BACKEND_BASE_URL` to your server's API origin.
For Docker Desktop, a server on the host is normally reachable at
`http://host.docker.internal:8080`. On Linux Docker Engine, add
`extra_hosts: ["host.docker.internal:host-gateway"]` to the frontend service or
use a routable host address. Podman commonly exposes the host as
`host.containers.internal`. Container loopback is not the host's loopback.

Start the stack:

```sh
docker compose --env-file .env.quickstart -f compose.quickstart.yml up -d
```

Open <http://localhost:3000>. Check dependency readiness with:

```sh
curl --fail http://localhost:3000/readyz
```

Both the page and readiness probe should be reachable before you sign in with
a Hubuum account. Frontend v0.0.19 targets server v0.0.18; review
[compatibility](https://hubuum.github.io/hubuum-frontend/v0.0.19/compatibility/)
before using a different server.

## Manage the quickstart

```sh
docker compose --env-file .env.quickstart -f compose.quickstart.yml logs -f frontend
docker compose --env-file .env.quickstart -f compose.quickstart.yml pull
docker compose --env-file .env.quickstart -f compose.quickstart.yml up -d
docker compose --env-file .env.quickstart -f compose.quickstart.yml down
```

Use `down -v` only when you also want to remove the Valkey data volume and sign
out all stored sessions.

This quickstart binds the frontend to loopback and does not configure TLS. Use
the Helm chart or the Hubuum Server single-host installer for production.

## Optional login backgrounds

Put AVIF, JPEG, PNG, or WebP files in `login-backgrounds/` before starting the
stack. To use another directory, set `LOGIN_BACKGROUNDS_HOST_DIR` in
`.env.quickstart`. Compose mounts it read-only; the files stay outside the image.
For Helm, use `loginBackgrounds.existingClaim` to mount a read-only PVC at
`/app/login-backgrounds`.
