# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | `v0.0.20` | `ghcr.io/hubuum/hubuum-server:v0.0.20` |
| `v0.0.22` | `v0.0.20` | `ghcr.io/hubuum/hubuum-server:v0.0.20` |
| `v0.0.21` | `v0.0.19` | `ghcr.io/hubuum/hubuum-server:v0.0.19` |
| `v0.0.20` | `v0.0.19` | `ghcr.io/hubuum/hubuum-server:v0.0.19` |
| `v0.0.19` | `v0.0.18` | `ghcr.io/hubuum/hubuum-server:v0.0.18` |
| `v0.0.18` | `v0.0.16` | `ghcr.io/hubuum/hubuum-server:v0.0.16` |
| `v0.0.17` | `v0.0.16` | `ghcr.io/hubuum/hubuum-server:v0.0.16` |
| `v0.0.16` | `v0.0.15` | `ghcr.io/hubuum/hubuum-server:v0.0.15` |
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

Required checks use the immutable image for the selected compatibility target.
For Frontend v0.0.22 and unreleased `main`, it is
`ghcr.io/hubuum/hubuum-server:v0.0.20@sha256:eaf59f8a4b4793030a78bc1637a8e2b9fad2f810b8621ff9a874dca534b9a23a`.

For Frontend v0.0.20/v0.0.21 and Server v0.0.19, it is
`ghcr.io/hubuum/hubuum-server@sha256:6fbe91693356b8885e6b1115cea4417dbf80747ba4af3eb0a15b855ffff47225`.
Scheduled tests against server `main` do not change a release's declared target.

## Interactive session upgrade

Frontend v0.0.22 requires the versioned login and rotating-refresh
contract from [server #483](https://github.com/hubuum/hubuum/pull/483).
The released Server v0.0.19 image does not provide this contract. Apply the server
migration and role grants with older API and worker replicas stopped, then start
matching binaries and upgrade the frontend. Clear existing BFF session records and sign in again. PATs and service credentials remain valid;
interactive sign-out does not revoke them. See [session security](session-security.md).

The new server also emits backup format 10. Upgrade restore executors with the
server, and retain a pre-upgrade backup and matching binaries for rollback.

## Advanced search capabilities

The builder uses version 1 of `POST /api/v1/search`, available in the supported
Server v0.0.20 contract. Its explicit target/field/operator matrix and limits are
documented in the [server search reference](https://github.com/hubuum/hubuum/blob/main/docs/search_api.md).
Unknown targets, predicates, bookmark versions and server errors never cause
an unfiltered fallback. The regular `GET /api/v1/search` page stays available.

Related-resource inspection requires the optional `POST /api/v1/search/hydrate`
capability included in Server v0.0.20. It is requested lazily through the
BFF, independently of root search. Its version 1 body has `root_class_id`,
`root_object_id`, an exact `class: { id }`, `depth` (1–10), and `limit` (1–50
visible paths). The response has the same bounds and root ID, `target_class_id`,
deduplicated `objects` and `relations`, `paths` containing `object_ids` and
`relation_ids`, and an explicit `truncated` flag. No hydration cursor exists.
The companion server implementation is [hubuum/hubuum#468](https://github.com/hubuum/hubuum/pull/468).

The scope is all visible related endpoints in that class/depth, not objects
satisfying a selected search predicate. Every path vertex and edge is authorized
by the server. Class/collection names are fetched separately through their
authorized endpoints and cached by ID. The frontend checks response identity,
path integrity and bounds, and binds in-memory inspection state to the executed
query, root page and object. It never fetches every result's relations eagerly.

On `404`/`405`, inspection reports that hydration is unavailable on this server;
the root result table remains usable. Other validation, authorization, work-limit
and changed-resource errors remain visible and require explicit retry. There is
no fallback to unbounded legacy relation endpoints. Root sorting, pagination and
totals use the original structured request with no hydration property.

See the [advanced-search guide](advanced-search.md) for grouping and Oslo-site
examples. Hydration is included in the declared Server v0.0.20 baseline.

## Released contract

Frontend v0.0.22 bundles the complete 257-operation OpenAPI contract from
Server v0.0.20. Search hydration and exact-name object history across identities
are part of that supported baseline. See [v0.0.22 verification](compatibility-evidence.md#frontend-v0022)
for source provenance, the immutable image, and completed live/browser checks. Earlier optional-preview evidence is
retained in [compatibility history](compatibility-evidence.md).

## Before upgrading

Deploy Server v0.0.20 and Frontend v0.0.22 together. Stop old API and worker
replicas, apply the server's offline migration and role grants, then start
matching API, worker, and restore binaries. Clear old frontend sessions and
sign in again. Existing PATs and service credentials remain independent.

The server emits backup format 10. Keep a pre-upgrade backup and matching
binaries for rollback; older servers cannot restore the new format. Follow the
[server deployment guide](https://hubuum.github.io/hubuum/v0.0.20/deployment/)
and [backup compatibility](https://hubuum.github.io/hubuum/v0.0.20/backup-restore/).
The existing single-host updater supports this transition; pin both component
tags and create a pre-upgrade snapshot before running it.

Reverse proxies should use HTTP/1.1 for direct server connections. Collection
managers need `ManageEventSubscription` and `ReadAudit` for delegated webhook
setup; shared sinks also need direct collection grants. Follow the
[browser guide](user-guide.md) for credential prompts and recovery workflows.

## Verification evidence

[Detailed evidence and historical migrations](compatibility-evidence.md) retain tested
image identities, dates, suite results, and earlier compatibility limits.

## Server v0.0.19

See [server v0.0.19](compatibility-evidence.md#server-v0019) for the release contract
and verification evidence.

## Server v0.0.18

See [server v0.0.18](compatibility-evidence.md#server-v0018) in the historical evidence.

## Server v0.0.17

See [server v0.0.17](compatibility-evidence.md#server-v0017) in the historical evidence.

## Server v0.0.16

See [server v0.0.16](compatibility-evidence.md#server-v0016) in the historical evidence.

## Server v0.0.15

See [server v0.0.15](compatibility-evidence.md#server-v0015) in the historical evidence.

## Collection-owned event destinations

See [collection-owned event destinations](compatibility-evidence.md#collection-owned-event-destinations) in the historical evidence.

## Moved reference sections

<!-- markdownlint-disable MD033 -->

| Topic | Reference |
| --- | --- |
| <span id="upgrade-requirements"></span>Upgrade requirements | [Details](compatibility-evidence.md#upgrade-requirements) |
| <span id="credential-approvals"></span>Credential approvals | [Details](compatibility-evidence.md#credential-approvals) |
| <span id="upgrade-requirements_1"></span>Upgrade requirements | [Details](compatibility-evidence.md#upgrade-requirements_1) |
| <span id="task-cancellation-and-deadlines"></span>Task cancellation and deadlines | [Details](compatibility-evidence.md#task-cancellation-and-deadlines) |
| <span id="schemas-and-repair-reports"></span>Schemas and repair reports | [Details](compatibility-evidence.md#schemas-and-repair-reports) |

<!-- markdownlint-enable MD033 -->
