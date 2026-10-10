# Deploy the frontend

Use the [Compose quick start](quickstart-compose.md) for evaluation against an
existing server. The [server single-host installer](https://hubuum.github.io/hubuum/v0.0.18/deployment/)
provisions a complete stack. For Kubernetes and OKD, use the Helm instructions
below and review [configuration](configuration.md).

## Deployment notes (OKD)

- Every replica requires `VALKEY_URL` from a Secret so opaque sessions remain
  available across Next.js runtimes, restarts, and pods.
- Use `/healthz` for liveness and `/readyz` for dependency-aware readiness.
- Frontend-owned BFF routes live under `/_hubuum-bff/...`; `/api/v0/...`
  and `/api/v1/...` remain available for direct backend routing at the edge.
- Keep Valkey private to the application network and enable persistence or
  replication according to the deployment's session-availability needs.
- TLS terminate at ingress; keep secure cookies enabled in production.

## Container and Helm publishing

After all required checks pass, commits to `main` publish a moving container
image:

```text
ghcr.io/hubuum/hubuum-frontend:main
```

The workflow also publishes an immutable full-SHA tag for each commit.
Both tags are multi-architecture images for `linux/amd64` and `linux/arm64`.

The Helm chart lives in `charts/hubuum-frontend` and is published to GHCR as
an OCI chart with a unique prerelease chart version per `main` build. Tagged
releases publish a matching stable chart version. The chart defaults its image
tag from `appVersion` and also accepts an immutable `image.digest`.

Install from the published OCI chart:

```bash
helm install hubuum oci://ghcr.io/hubuum/charts/hubuum-frontend \
  --version 0.0.19 \
  --set backend.baseUrl=https://hubuum-api.example.com \
  --set valkey.existingSecret.name=hubuum-frontend-valkey
```

For OKD Routes, enable the chart route resource:

```bash
helm upgrade --install hubuum oci://ghcr.io/hubuum/charts/hubuum-frontend \
  --version 0.0.19 \
  --set backend.baseUrl=https://hubuum-api.example.com \
  --set route.enabled=true \
  --set route.host=hubuum.example.com
```
