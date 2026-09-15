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
`85a18be2e0d9240f917b6ba8ba5e0f5ab71f34a0`. That development contract still reports
`info.version: 0.0.14`; endpoint availability, rather than that version string,
selects the versioned-schema interface. The supported release target and deployment
defaults remain `v0.0.14` until the next server release is selected.

An additional pull-request contract job tests the published main image at
`ghcr.io/hubuum/hubuum-server@sha256:5aca779e65bca5f75affa110923b3767d7af8d21b5f344a17c8c90f28b41b478`
for the CI runner's `linux/amd64` platform.
Its image source revision matches the source snapshot above and includes the
schema evolution, backup capture budgets, saved diagnostics, and HTML repair reports. The running
image's OpenAPI document matches the vendored snapshot exactly. Scheduled and
manually dispatched checks can still follow `:main`; preview checks require the
schema and HTML repair-report endpoints instead of silently skipping them.

The Schema workspace stages immutable revisions, compares changes, runs impact
analysis, and activates with explicit strict or administrator pending policy.
The review step's **Analyze impact** action starts the check directly. Normal
progression to **Activate** stays disabled until a current compatible analysis
is available (an authoritatively empty class needs no scan). Failed, incomplete,
or outdated results keep the user at analysis with options to revise the proposal
or analyze again. Administrators can separately expand **Override compatibility
checks** and confirm activation with pending validation; this may leave existing
objects invalid and does not repair their data.
Impact reports can be downloaded as JSON, including every field returned by the
server and all retained object IDs, regardless of the displayed page. Downloads
are generated on demand; the screen pages failure groups and IDs to keep large
reports manageable. Unfinished or interrupted work is labeled as a partial report.
Display pagination does not reduce the server response size: polling still reads
all committed findings, so payload size grows with the number of mismatches.

With [server PR #412](https://github.com/hubuum/hubuum/pull/412), `impact.failures`
groups every committed mismatch by its first failure. Each group's `samples`
field contains all of its object IDs; the separate `invalid_samples` summary
remains capped at 20. Passing objects remain aggregate counts, and stale or
uninspectable objects have no proven mismatch diagnosis. Running or interrupted
analyses include only findings committed so far.

The server changes for [#415](https://github.com/hubuum/hubuum/issues/415) add
`impact.findings`, with saved object revisions, inspection times, and up to 32
diagnostic issues per object. **What needs fixing** shows the server's explanations,
JSON Pointer locations, expected constraints, actual types/sizes, and explicit
omissions. Root pointers, omitted locations, and expected JSON null remain distinct.
Alternative-branch explanations are not presented as independently required repairs.
Diagnostics describe inspected data; the frontend does not reconstruct them from
current objects. A null snapshot is explained as a legacy first-failure finding.

When the response includes `findings`, **View HTML report** and **Download HTML
report** generate a server report if none is retained, then reuse its saved output.
**Refresh HTML report** explicitly replaces that rendering using the latest saved
findings and selected layout. It never starts a new analysis or activates a schema.
A failed generation preserves the prior report. The frontend supplies absolute
links to its actual `/objects/{class_id}/{object_id}` routes so downloaded links
work. HTML is opened through the authenticated BFF, with scripts and same-origin
access disabled; only these repair reports may open object pages in new tabs that
do not inherit the report sandbox. Access is checked by the backend for generation,
viewing, and downloads, including already retained output.

**Report layout** optionally selects a saved HTML template; the server's default
needs no template. A custom layout must be a body fragment containing
`{{ report_content }}` exactly once, including when using shared includes. In the
template editor, choose HTML output, reusable fragment, and **Full document** mode
to avoid the frontend's standard document wrapper, then supply just the layout
fragment. The server supplies the outer document and complete canonical findings.
Its output limit fails generation explicitly rather than saving truncated HTML.

Older reports may retain at most 20 groups and five IDs per group, including
checkpoints resumed after an upgrade. The frontend identifies omissions from
`ungrouped_failures` and groups whose `objects` count exceeds `samples.length`,
and advises a new analysis on an updated server. It preserves those reports as
returned when downloading; it cannot recover missing IDs. A short list alone
does not imply sampling. Older servers without `findings` retain the grouped
failure display and JSON download. Neither the supported release nor deployment
defaults change with this development preview.

Before upgrading the server for saved diagnostics and HTML reports, drain old
schema workers, apply migration `20260914000003`, then start matching upgraded API
and worker processes. Rerun older analyses to obtain richer diagnostics; upgrades
cannot recover details that were never saved. Retained HTML belongs to its source
task and is not included in logical schema-work backups or restores.

The workspace also exposes retained revision history, object compliance, and background
revalidation. Ordinary metadata saves omit schema fields. Older servers retain
the inline editor when revision discovery returns 404; authorization or transient
errors do not enable that fallback. Audit filters include `class_schema` and
`object_validation`, tasks recognize `schema_validation`, and administrator
configuration includes the effective schema validation limits.

Administrator Configuration also shows the effective backup capture-row limit
introduced by [server PR #408](https://github.com/hubuum/hubuum/pull/408), or
`n/a` when an older server omits it. Server main enforces byte and row-work
budgets during backup capture, including offline administrator operations.
`HUBUUM_BACKUP_MAX_CAPTURE_ROWS` defaults to 1,000,000; configure matching limits
for the server, workers, and administrator tools when larger workloads need them.

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
[server schema and upgrade guide](https://github.com/hubuum/hubuum/blob/85a18be2e0d9240f917b6ba8ba5e0f5ab71f34a0/docs/schema_evolution.md)
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
