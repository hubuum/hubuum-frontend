# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `main` (unreleased) | `v0.0.4` | `ghcr.io/hubuum/hubuum-server:v0.0.4` |
| `v0.0.4` | `v0.0.3` | `ghcr.io/hubuum/hubuum-server:v0.0.3` |
| `v0.0.3` | `v0.0.2` | `ghcr.io/hubuum/hubuum-server:v0.0.2` |
| `v0.0.2` | `v0.0.2` | `ghcr.io/hubuum/hubuum-server:v0.0.2` |
| `v0.0.1` | `v0.0.1` | `ghcr.io/hubuum/hubuum-server:v0.0.1` |

Required pull-request and release checks use the immutable digest behind the
listed server tag. Unreleased `main` validates the generated Server `v0.0.4`
contract and the live scoped and unscoped token lifecycles against
`sha256:60142d605f423b1dc58d9dfe709164b0d5ec93befd2d702f9bdca7ee0654a583`.
A separate scheduled workflow tests the frontend against the moving backend
`:main` image to surface future compatibility changes without making normal CI
nondeterministic.

Compatibility means that authentication, session handling, and the frontend's
core backend contract suite pass. Frontend `v0.0.2` relies on Server `v0.0.2`
for admin backup/restore, the read-only runtime configuration projection, and
shared and personal computed fields. Frontend `v0.0.4` relies on Server
`v0.0.3` for object aggregates, computed filtering and sorting, public
pagination discovery, atomic JSON Patch, and explicit by-name API routes.
Current unreleased `main` additionally adopts Server `v0.0.4`'s unified token
scope payloads, numeric aggregate measures, durable task provenance, initiator
filters, bounded idempotency keys, and remote-header restrictions. The token
payload change is breaking, so this unreleased frontend should not be used to
mint tokens against Server `v0.0.3`.
