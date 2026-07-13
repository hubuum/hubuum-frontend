# Frontend Compose quickstart

This quickstart runs Hubuum Frontend and Valkey. It does not install Hubuum
Server or PostgreSQL; point it at an existing Hubuum Server instance.

## Requirements

- Docker Compose 2.20 or newer, or a compatible Podman Compose installation.
- A Hubuum Server URL reachable from inside the frontend container.

## Start

Copy the example environment and set `BACKEND_BASE_URL`:

```sh
cp .env.quickstart.example .env.quickstart
docker compose --env-file .env.quickstart -f compose.quickstart.yml up -d
```

Open <http://localhost:3000>. Check dependency readiness with:

```sh
curl --fail http://localhost:3000/readyz
```

For Docker Desktop, a server running directly on the host is normally
reachable as `http://host.docker.internal:8080`. On Linux Docker Engine, add
`extra_hosts: ["host.docker.internal:host-gateway"]` to the frontend service or
use a routable host address. Podman commonly exposes the host as
`host.containers.internal`.

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
