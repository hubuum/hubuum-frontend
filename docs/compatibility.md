# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | `v0.0.9` | `ghcr.io/hubuum/hubuum-server:v0.0.9` |
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
listed server tag. Unreleased `main` validates the generated Server `v0.0.9`
contract and the live scoped and unscoped token lifecycles against
`sha256:1f12baf882b6d3df5b4b2dbdf26aad0793274e57f86a2c186b8e1e68632db5db`.
A separate scheduled workflow tests the frontend against the moving backend
`:main` image to surface future compatibility changes without making normal CI
nondeterministic.

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
