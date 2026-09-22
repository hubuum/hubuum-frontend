# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | `v0.0.15` | `ghcr.io/hubuum/hubuum-server:v0.0.15` |
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
listed server tag. Unreleased `main` targets Server `v0.0.15` at
`sha256:36af667dbc9e221a40448496d4a87e168c999d0834df4b69177345ff3d36e821`.
Frontend `v0.0.15` retains its Server `v0.0.14` target at
`sha256:6c1c8d7316a1f60a02e4505611a44e21030ba678b5b451f5b293a12f2bd87594`.
A separate scheduled workflow follows the moving backend `:main` image.

## Optional credential approvals

The frontend also supports the fresh-authentication protocol from
[Server PR #423](https://github.com/hubuum/hubuum/pull/423). Support is selected
per operation by the server's `403` / `reauthentication_required` response, not
by a version check or a required capability probe. The minimum backend contract
and the pinned release target remain unchanged.

Token creation/renewal, local user creation, password changes, credential imports
(including dry runs), and restore confirmation use a password dialog when
required. The dedicated BFF obtains and consumes an approval in request memory,
using the same bearer for both requests. Token expiry is copied verbatim from
the approval response, including microsecond precision. Revision preconditions,
import idempotency keys, and restore confirmation capabilities are preserved.
The generic proxy blocks direct approval creation to keep approval secrets out
of the browser; safe approval metadata reads remain available for recovery.

Older servers receive the original mutation with no approval discovery or
password prompt. A required approval that fails never falls back to a
bearer-only mutation. Incorrect passwords preserve valid sessions; throttling,
provider failures, permission errors, and expired sessions retain their distinct
failure behavior. A lost mutation response requires checking account/task/restore
state before retrying; the BFF reports the approval record ID when available.

## Server v0.0.15

The OpenAPI snapshot is taken directly from the server's `v0.0.15` tag
(commit `4bb889c6`). Normal contract checks now require versioned schemas,
saved diagnostics, HTML repair reports, and task cancellation. The earlier
separate schema-preview CI job is superseded by the release contract check.

### Task cancellation and deadlines

Task detail pages submit cancellation through the authenticated BFF. Queued
withdrawal sends `expected_status: queued`; a conflict refreshes the task and
requires another explicit request. Active cancellation returns `202` and keeps
polling until the server acknowledges cleanup. A completed task keeps its factual
result. Optional reasons are single-line text limited to 512 UTF-8 bytes.

The page displays cancellation actor, reason and time, execution deadline,
terminal reason, authoritative terminal unattempted counts, aggregate import
receipts, and remote dispatch evidence. Strict imports roll back uncommitted
work; best-effort imports and reindex/schema batches retain committed work.
Cancelled exports and backups publish no partial output. Remote requests may
already have caused effects and are never automatically retried by the console.
Configuration shows all six per-kind execution limits. Queue wait does not
consume those limits; deadlines are pinned at first claim.

The backend enforces cancellation authority independently of task visibility.
Owners, unscoped administrators, and eligible service-account owner-group members
may cancel authorized work. Scoped tokens are limited to their own submissions;
internal reindex and schema work require an unscoped administrator. Treetop
installations must deploy the `CancelTask` action and policies. Request
cancellation before restore maintenance draining begins; the API returns `503`
once that gate closes. Restore confirmation is outside task cancellation.

### Schemas and repair reports

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

**What needs fixing** defaults to **By error**, consolidating identical retained
issue descriptions and listing every affected object with its inspected revision,
time, and truncation notice. An object may appear under multiple errors; repeated
identical occurrences within an object are counted without duplicating its link.
Different locations, constraints, actual type/size details, alternative flags, or
omissions stay separate. **By object** retains the original detailed view. The
JSON download preserves the server response without consolidating its records.
Server `v0.0.15` does not consolidate errors in HTML repair reports. The console's
**By error** view is local presentation of the retained per-object diagnostics;
it does not change the server response or HTML. **Refresh HTML report** renders
saved findings again using the released server renderer and its resource limits.

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
The server's `HUBUUM_EXPORT_MAX_OUTPUT_BYTES` defaults to 256 KiB and can be raised
up to 16 MiB for HTML repair reports. Finding assembly uses the smaller of this
setting and 4 MiB; the expanded template context has a separate 4 MiB ceiling.
An assembly-budget error during HTML generation does not mean the analysis
failed or enforcement changed. Saved findings and the JSON download remain
available when they fit the JSON report's separate 16 MiB assembly budget.
Increasing the output setting requires a backend restart, but no new analysis.
Rendering also uses `HUBUUM_EXPORT_TEMPLATE_FUEL`, which defaults to 50,000
MiniJinja execution units. An "engine ran out of fuel" error means this separate
execution limit was reached; increasing the byte limit alone does not fix it.
The local sandbox sets 1,000,000 execution units for the corpus's repair reports.

Older reports may retain at most 20 groups and five IDs per group, including
checkpoints resumed after an upgrade. The frontend identifies omissions from
`ungrouped_failures` and groups whose `objects` count exceeds `samples.length`,
and advises a new analysis on an updated server. It preserves those reports as
returned when downloading; it cannot recover missing IDs. A short list alone
does not imply sampling. Older servers without `findings` retain the grouped
failure display and JSON download.

Before upgrading, drain old task and schema workers and run `hubuum-admin --migrate`
as a separate workload. This includes task cancellation migration `20260914000001`,
saved diagnostics migration `20260914000003`, schema evolution/findings, and the
byte-ordered cursor indexes. Schedule a quiet period for constraint validation and
index builds. Start matching `v0.0.15` API, worker, administrator, template worker,
and restore-executor binaries with consistent limits. Rerun older analyses to
obtain richer diagnostics; upgrades cannot recover details that were never saved. Retained HTML belongs to its source
task and is not included in logical schema-work backups or restores.

The workspace also exposes retained revision history, object compliance, and background
revalidation. Ordinary metadata saves omit schema fields. Older servers retain
the inline editor when revision discovery returns 404; authorization or transient
errors do not enable that fallback. Audit filters include `class_schema` and
`object_validation`, tasks recognize `schema_validation`, and administrator
configuration includes the effective schema validation limits.

Administrator Configuration also shows the effective backup capture-row limit
introduced by [server PR #408](https://github.com/hubuum/hubuum/pull/408), or
`n/a` when an older server omits it. Server `v0.0.15` enforces byte and row-work
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

Server `v0.0.15` uses **backup format 6**. Restore format 5 and older artifacts with
their matching server release, then migrate the database and create a new format
6 backup. The frontend does not convert backup documents. Drain old workers,
run migrations before startup, and use matching server, administrator, worker,
and restore-executor binaries. Existing enforced objects begin pending after
migration; administrators can revalidate from the Schema workspace. Review the
[server schema and upgrade guide](https://github.com/hubuum/hubuum/blob/v0.0.15/docs/schema_evolution.md)
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
