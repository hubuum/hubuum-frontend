# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | `v0.0.14` | `ghcr.io/hubuum/hubuum-server:v0.0.14` |
| `v0.0.15` | `v0.0.14` | `ghcr.io/hubuum/hubuum-server:v0.0.14` |
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
listed server tag. Frontend `v0.0.15` and unreleased `main` validate the generated Server `v0.0.14`
contract and the live scoped and unscoped token lifecycles against
`sha256:6c1c8d7316a1f60a02e4505611a44e21030ba678b5b451f5b293a12f2bd87594`.
A separate scheduled workflow tests the frontend against the moving backend
`:main` image to surface future compatibility changes without making normal CI
nondeterministic.

## Server main schema preview

The unreleased frontend also prepares for
[server PR #402](https://github.com/hubuum/hubuum/pull/402). Its OpenAPI snapshot
comes from server main commit
`d10a9e6c92882503ef47dd54c5b2ac413b45541c`. That development contract still reports
`info.version: 0.0.14`; endpoint availability, rather than that version string,
selects the versioned-schema interface. The supported release target and deployment
defaults remain `v0.0.14` until the next server release is selected.

An additional pull-request contract job tests the published main image at
`ghcr.io/hubuum/hubuum-server@sha256:b423ea6a7461662cb9a1e6324270358efa17ae9f909d55b3bb814c36d78b847e`.
Its image source revision is the PR #402 merge,
`2d67fa5f6f1b3ef54c76c93c36932d2592f29e90`, which predates the source snapshot above.
This records the available image precisely rather than claiming that a moving
tag necessarily contains the latest source commit. The running image's OpenAPI
document matches the vendored snapshot exactly. Scheduled and manually
dispatched checks can still follow `:main`; preview checks require the new
schema endpoints instead of silently skipping them.

The Schema workspace stages immutable revisions, compares changes, runs impact
analysis, and activates with explicit strict or administrator pending policy.
It also exposes retained revision history, object compliance, and background
revalidation. Ordinary metadata saves omit schema fields. Older servers retain
the inline editor when revision discovery returns 404; authorization or transient
errors do not enable that fallback. Audit filters include `class_schema` and
`object_validation`, tasks recognize `schema_validation`, and administrator
configuration includes the effective schema validation limits.

Imports preserve explicit `schema_activation` and its proof during dry runs and
submission. Such imports must use their original file destinations: overriding
the destination could attach class-local revision numbers to another class.
To change a populated class policy through import, stage the exact policy in
its Schema workspace and include that revision in the file. Legacy policy
overwrites now conflict. Activation requires administrator authority; strict
imports roll back failed work together, while best-effort imports can retain
successful class activation despite separate object failures.

Server main uses **backup format 6**. Restore format 5 and older artifacts with
their matching server release, then migrate the database and create a new format
6 backup. The frontend does not convert backup documents. Drain old workers,
run migrations before startup, and use matching server, administrator, worker,
and restore-executor binaries. Existing enforced objects begin pending after
migration; administrators can revalidate from the Schema workspace. Review the
[server schema and upgrade guide](https://github.com/hubuum/hubuum/blob/d10a9e6c92882503ef47dd54c5b2ac413b45541c/docs/schema_evolution.md)
before testing an upgrade with real data.

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

Frontend `v0.0.15` adopts Server `v0.0.14` with no API shape changes. The server
fixes backup validation, external membership provenance, retained history, and
resource revisions after history-free restores. Backup format 5 is unchanged,
and this release adds no database migration. The certified application upgrade
and rollback path is Server `v0.0.13` to `v0.0.14`; application rollback retains
the migrated database. Existing history-free backup artifacts can be restored
directly with the fixed restore executor.

Before deploying Server `v0.0.14`, run `hubuum-admin --migrate` as a separate
one-shot workload and deploy `hubuum-admin --restore-executor` before enabling
web restore confirmations. Both requirements apply to the default single-role
mode. Use matching `v0.0.14` binaries for the server, administrator, template worker,
and separately deployed restore executor to apply the recovery fixes. The
disposable contract suite exercises confirmation,
capability-only completion polling, and token invalidation with background
workers running.
See the [Server v0.0.14 release notes](https://github.com/hubuum/hubuum/releases/tag/v0.0.14)
for these fixes and matching-binary requirements.
See the [Server v0.0.12 upgrade notes](https://github.com/hubuum/hubuum/releases/tag/v0.0.12)
for the certified upgrade path, version 5 backups, resource limits, and optional
split-role deployment. Older frontend releases assume synchronous restoration
and should not confirm web restores against this server release.
