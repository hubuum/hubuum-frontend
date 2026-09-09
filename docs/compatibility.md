# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | `v0.0.13` | `ghcr.io/hubuum/hubuum-server:v0.0.13` |
| `v0.0.14` | `v0.0.13` | `ghcr.io/hubuum/hubuum-server:v0.0.13` |
| `v0.0.13` | `v0.0.9` | `ghcr.io/hubuum/hubuum-server:v0.0.9` |
| `v0.0.12` | `v0.0.9` | `ghcr.io/hubuum/hubuum-server:v0.0.9` |
| `v0.0.11` | `v0.0.9` | `ghcr.io/hubuum/hubuum-server:v0.0.9` |
| `v0.0.10` | `v0.0.5` | `ghcr.io/hubuum/hubuum-server:v0.0.5` |
| `v0.0.9` | `v0.0.5` | `ghcr.io/hubuum/hubuum-server:v0.0.5` |
| `v0.0.8` | `v0.0.5` | `ghcr.io/hubuum/hubuum-server:v0.0.5` |
| `v0.0.7` | `v0.0.5` | `ghcr.io/hubuum/hubuum-server:v0.0.5` |
| `v0.0.6` | `v0.0.5` | `ghcr.io/hubuum/hubuum-server:v0.0.5` |
| `v0.0.5` | `v0.0.4` | `ghcr.io/hubuum/hubuum-server:v0.0.4` |
| `v0.0.4` | `v0.0.3` | `ghcr.io/hubuum/hubuum-server:v0.0.3` |
| `v0.0.3` | `v0.0.2` | `ghcr.io/hubuum/hubuum-server:v0.0.2` |
| `v0.0.2` | `v0.0.2` | `ghcr.io/hubuum/hubuum-server:v0.0.2` |
| `v0.0.1` | `v0.0.1` | `ghcr.io/hubuum/hubuum-server:v0.0.1` |

Required pull-request and release checks use the immutable digest behind the
listed server tag. Frontend `v0.0.14` and unreleased `main` validate the generated Server `v0.0.13`
contract and the live scoped and unscoped token lifecycles against
`sha256:512562e789d6430875c5075faf832a9669a4f266f7fe9fbf8c1524b49a6476c5`.
A separate scheduled workflow tests the frontend against the moving backend
`:main` image to surface future compatibility changes without making normal CI
nondeterministic.

Frontend `v0.0.14` uses Server `v0.0.13` API types, including structured search,
storage backend configuration, and backup format version 5. Existing unified
search and class-selection flows keep their current behavior. Runtime
configuration uses the storage query budget while retaining the older database
timeout field as a fallback. To recover from a version 4 backup, restore it using
the older server before upgrading and creating a version 5 backup; the frontend submits
backup documents to the server for validation without converting them.

Compatibility means that authentication, session handling, and the frontend's
core backend contract suite pass. Frontend `v0.0.2` relies on Server `v0.0.2`
for admin backup/restore, the read-only runtime configuration projection, and
shared and personal computed fields. Frontend `v0.0.4` relies on Server
`v0.0.3` for object aggregates, computed filtering and sorting, public
pagination discovery, atomic JSON Patch, and explicit by-name API routes.
Frontend `v0.0.5` additionally adopts Server `v0.0.4`'s unified token scope
payloads, numeric aggregate measures, durable task provenance, initiator
filters, bounded idempotency keys, and remote-header restrictions. The token
payload change is breaking, so Frontend `v0.0.5` should not be used to mint
tokens against Server `v0.0.3`.
Frontend `v0.0.6` adopts Server `v0.0.5`'s public default-token lifetime,
authoritative token expiry responses, token-retention configuration, and
restored permission-aware import and export submission.
Frontend `v0.0.7` retains the Server `v0.0.5` contract while adding
frontend-managed bookmarkable template reports and raw stored-output routes.
Frontend `v0.0.8` retains the Server `v0.0.5` contract while adding task
elapsed-time display and faster, instrumented bookmarkable-report refreshes.
Frontend `v0.0.9` retains the Server `v0.0.5` contract while introducing the
Stillwater design system, runtime-mounted login backgrounds, and streamlined
navigation and resource workflows.
Frontend `v0.0.10` retains the Server `v0.0.5` contract while adding streaming
BFF transport, retry-safe task submissions, structured operational events,
refined object workflows, and stronger authenticated-browser quality gates.
Frontend `v0.0.11` adopts Server `v0.0.9`'s canonical point responses,
revisioned resources and permission sets, token lifecycle endpoints, nested
group-member principals, and backup format version 4.
Frontend `v0.0.12` retains the Server `v0.0.9` contract while adding richer
audit filtering, permission-aware resource search, stricter BFF origin and
administrator checks, and direct recovery from expired sessions.
Frontend `v0.0.13` retains the Server `v0.0.9` contract while adding scalable
on-demand target-object search to relation creation and refreshing the complete
application, development, generation, container, and CI dependency baseline.

Frontend `v0.0.14` adopts Server `v0.0.13`, including asynchronous web restore
confirmation. Confirmation returns `202 Accepted`; the console retains the
restore capability in memory and polls until a terminal result, including after
old bearer sessions become invalid. Keep the restore page open until it finishes.
The exact restore-status BFF route accepts only capability-authenticated reads;
all other backend proxy routes continue to require a frontend session.

Before deploying Server `v0.0.13`, run `hubuum-admin --migrate` as a separate
one-shot workload and deploy `hubuum-admin --restore-executor` before enabling
web restore confirmations. Both requirements apply to the default single-role
mode. Use matching `v0.0.13` binaries for the server, administrator, template worker,
and separately deployed restore executor. This release fixes restore failures
while instances acknowledge maintenance and preserves JSON `null` during
PostgreSQL restoration. The disposable contract suite exercises confirmation,
capability-only completion polling, and token invalidation with background
workers running.
See the [Server v0.0.13 release notes](https://github.com/hubuum/hubuum/releases/tag/v0.0.13)
for these fixes and matching-binary requirements.
See the [Server v0.0.12 upgrade notes](https://github.com/hubuum/hubuum/releases/tag/v0.0.12)
for the certified upgrade path, version 5 backups, resource limits, and optional
split-role deployment. Older frontend releases assume synchronous restoration
and should not confirm web restores against this server release.
