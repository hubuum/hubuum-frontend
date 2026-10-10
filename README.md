# Hubuum Frontend

The browser interface for Hubuum: browse inventory, manage relationships, run
reports, and administer access. Server-side sessions keep Hubuum bearer tokens
out of the browser.

Frontend **v0.0.19**, released **2026-10-06**, targets Hubuum Server **v0.0.18**.
Read [compatibility](docs/compatibility.md) before pairing other releases.

[Documentation](https://hubuum.github.io/hubuum-frontend/) · [Releases](https://github.com/hubuum/hubuum-frontend/releases/tag/v0.0.19) · [Hubuum ecosystem](https://hubuum.github.io/)

## Quick start

Download the versioned Compose archive and follow the complete
[Compose quick start](docs/quickstart-compose.md). It runs the frontend and
Valkey against an existing Hubuum server. For a complete server/frontend stack,
use the [single-host installer](https://hubuum.github.io/hubuum/v0.0.18/deployment/).

Developers should use [local development](docs/development.md); browser users
should start with [Atlas](docs/example-dataset.md) and the
[user guide](docs/user-guide.md).

### Container quickstart

See [download, configure, and start](docs/quickstart-compose.md#start).

## Configuration

See [runtime settings, proxy routing, and login backgrounds](docs/configuration.md).

## Release artifacts

Release v0.0.19 provides Linux AMD64/ARM64 images, a Helm chart, and a
checksum-protected Compose archive pinned to the image digest. The image is
`ghcr.io/hubuum/hubuum-frontend:v0.0.19`; the Helm chart is
`oci://ghcr.io/hubuum/charts/hubuum-frontend:0.0.19`.
See [deployment](docs/deployment.md) and [release evidence](docs/compatibility.md).

## Features

Browse classes and objects, edit data, follow relations, build reports, track
tasks, and manage authorized workflows. See the [browser guide](docs/user-guide.md).

<!-- markdownlint-disable-next-line MD033 -->
<span id="what-is-scaffolded"></span>

## Further reading

<!-- markdownlint-disable MD033 -->

| Topic | Guide |
| --- | --- |
| <span id="architecture"></span>Architecture | [Guide](docs/architecture.md#architecture) |
| <span id="bff-route-layout"></span>BFF route layout | [Guide](docs/architecture.md#bff-route-layout) |
| <span id="backend-api-access-assumptions"></span>Backend API access assumptions | [Guide](docs/architecture.md#backend-api-access-assumptions) |
| <span id="credential-operations"></span>Credential operations | [Guide](docs/user-guide.md#credential-operations) |
| <span id="scoped-identities"></span>Scoped identities | [Guide](docs/user-guide.md#scoped-identities) |
| <span id="workspace-navigation-and-resource-selection"></span>Workspace navigation and resource selection | [Guide](docs/user-guide.md#workspace-navigation-and-resource-selection) |
| <span id="object-data-columns"></span>Object data columns | [Guide](docs/user-guide.md#object-data-columns) |
| <span id="bookmarkable-reports"></span>Bookmarkable reports | [Guide](docs/user-guide.md#bookmarkable-reports) |
| <span id="chat-webhooks"></span>Chat webhooks | [Guide](docs/user-guide.md#chat-webhooks) |
| <span id="historical-snapshots-and-object-restoration"></span>Historical snapshots and object restoration | [Guide](docs/user-guide.md#historical-snapshots-and-object-restoration) |
| <span id="administrator-backup-and-restore"></span>Administrator backup and restore | [Guide](docs/user-guide.md#administrator-backup-and-restore) |
| <span id="collection-hierarchy"></span>Collection hierarchy | [Guide](docs/user-guide.md#collection-hierarchy) |
| <span id="security-audit-gate"></span>Security audit gate | [Guide](docs/development.md#security-audit-gate) |
| <span id="live-backend-contract-tests"></span>Live backend contract tests | [Guide](docs/development.md#live-backend-contract-tests) |
| <span id="openapi-generation"></span>OpenAPI generation | [Guide](docs/development.md#openapi-generation) |
| <span id="documentation-only-ci"></span>Documentation-only CI | [Guide](docs/development.md#documentation-only-ci) |
| <span id="deployment-notes-okd"></span>Deployment notes (OKD) | [Guide](docs/deployment.md#deployment-notes-okd) |
| <span id="container-and-helm-publishing"></span>Container and Helm publishing | [Guide](docs/deployment.md#container-and-helm-publishing) |
| <span id="important-caveat"></span>Query support | [Server query reference](https://hubuum.github.io/hubuum/v0.0.18/querying/) |

<!-- markdownlint-enable MD033 -->
