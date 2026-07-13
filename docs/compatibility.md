# Compatibility

Hubuum Frontend and Hubuum Server are versioned independently. Deployments
should pin both components to explicit versions.

| Frontend | Supported Hubuum Server | CI contract target |
| --- | --- | --- |
| `v0.0.1` | `v0.0.1` | `ghcr.io/hubuum/hubuum-server:v0.0.1` |

Required pull-request and release checks use the immutable digest behind the
listed server tag. A separate scheduled workflow tests the frontend against
the moving backend `:main` image to surface future compatibility changes
without making normal CI nondeterministic.

Compatibility means that authentication, session handling, and the frontend's
core backend contract suite pass. Newer server features may not be visible in
an older frontend, and newer frontends may hide optional features when the
corresponding server endpoint returns `404`.
