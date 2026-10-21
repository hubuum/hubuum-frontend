# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | Versioned session API from [server #483](https://github.com/hubuum/hubuum/pull/483) | Immutable server snapshot in CI |
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

Required checks use the immutable server image for the selected release.
For Frontend v0.0.20/v0.0.21 and Server v0.0.19, it is
`ghcr.io/hubuum/hubuum-server@sha256:6fbe91693356b8885e6b1115cea4417dbf80747ba4af3eb0a15b855ffff47225`.
Scheduled tests against server `main` do not change a release's declared target.

## Interactive session upgrade

Unreleased frontend builds require the versioned login and rotating-refresh
contract from [server #483](https://github.com/hubuum/hubuum/pull/483).
The released Server v0.0.19 image does not provide this contract. Apply the server
migration and role grants with older API and worker replicas stopped, then start
matching binaries and upgrade the frontend. Clear existing BFF session records and sign in again. PATs and service credentials remain valid;
interactive sign-out does not revoke them. See [session security](session-security.md).

The new server also emits backup format 10. Upgrade restore executors with the
server, and retain a pre-upgrade backup and matching binaries for rollback.

## Advanced search capabilities

The builder uses version 1 of `POST /api/v1/search`, available in the supported
Server v0.0.19 contract. Its explicit target/field/operator matrix and limits are
documented in the [server search reference](https://github.com/hubuum/hubuum/blob/main/docs/search_api.md).
Unknown targets, predicates, bookmark versions and server errors never cause
an unfiltered fallback. The regular `GET /api/v1/search` page stays available.

Related-resource inspection requires the optional `POST /api/v1/search/hydrate`
capability introduced after Server v0.0.19. It is requested lazily through the
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
examples. The optional capability does not change the release compatibility
baseline above.

## Optional preview snapshot

Release v0.0.21 retains the Server v0.0.19 baseline. Search hydration and
exact-name object history require newer server capabilities and remain optional.
The reproducible preview target is server commit
`00135f71aedcf52ecd8395906a227446121e48e9`, using image
`ghcr.io/hubuum/hubuum-server@sha256:2e866b6fcb4a9c2023324b722ee0c494d98fc02a2d24feb5c19ebd451878fc27`.
A preview server can still report version 0.0.19; use the commit and digest to
identify it. This snapshot is a compatibility test target, not the deployment
default.

The bundled contract starts with the released OpenAPI from server commit
`59faad2641620e457d5b0d9d7e112ee395b151ff`, supplemented by search hydration from
`41b4f68c3bb42180b14e564b8b19d0f0436929aa` and exact-name object history from
`bee167bdf444918406f8ab22ffe9e19695585f60`. The release checks both the released
baseline and the pinned preview; the remaining post-release server endpoints
are outside this frontend release's contract.

Exact-name object history searches retained class-scoped snapshots across
identities. Server v0.0.19 shows an explicit unavailable state for this optional
view; ordinary identity history remains available. See the
[history guide](user-guide.md#historical-snapshots-and-object-restoration).

## Before upgrading

Frontend v0.0.21 retains the server v0.0.19 baseline from v0.0.20. Deploy that
server before upgrading the frontend. Replace blank local account names with nonblank accounts and transfer
group memberships; correct externally managed names in the identity provider.
Upgrade strict event readers to accept successful-login events before enabling
the new server. Older servers cannot read the new event catalog entry.

The server uses HTTP/1.1 for direct connections, including TLS. Configure reverse
proxies to use HTTP/1.1 upstream; they can continue offering HTTP/2 to clients.

Backups now use format 9; formats 6, 7, and 8 remain readable. Apply query usage
migrations and reconcile role grants. Upgrade every API, worker, and restore
executor together, and retain a pre-upgrade backup and matching binaries for
recovery. Older servers cannot restore format 9. See the
[server release notes](https://github.com/hubuum/hubuum/releases/tag/v0.0.19)
and [backup compatibility](https://hubuum.github.io/hubuum/v0.0.19/backup-restore/).

Server v0.0.18 or newer is required for delegated
webhook setup. Collection managers need `ManageEventSubscription` and `ReadAudit`;
shared sinks also need direct collection grants. Follow the
[browser guide](user-guide.md) for credential prompts, schema repair, and restore
workflows; upgrade history is not a substitute for those instructions.

Server v0.0.18 requires an offline upgrade from v0.0.17 and emits backup format 8;
older servers cannot restore that format. Follow the canonical
[server upgrade and recovery instructions](https://hubuum.github.io/hubuum/v0.0.18/events/#upgrade-and-rollback)
and [backup compatibility](https://hubuum.github.io/hubuum/v0.0.18/backup-restore/).
Use the server guide for the actual version transition rather than copying
migration commands from an older client release.

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
