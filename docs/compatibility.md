# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | `v0.0.18` | `ghcr.io/hubuum/hubuum-server:v0.0.18` |
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
For v0.0.19, it is
`ghcr.io/hubuum/hubuum-server@sha256:5b54248f19171200dfa497174d385a48f90666a415cb31732797043d5e182fc4`.
Scheduled tests against server `main` do not change a release's declared target.

## Before upgrading

Frontend v0.0.19 targets server v0.0.18. Deploy that server before using delegated
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
