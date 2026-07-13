# Changelog

All notable changes to Hubuum Frontend are documented in this file.

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Configurable object-reachability depth, persisted in the relations URL, for
  exploring paths up to 10 hops.

### Changed

- Simplified related-object cards to emphasize the object, description, hop
  count, and indirect route without displaying object data previews.

## [0.0.1] - 2026-07-13

### Added

- Initial Next.js console for Hubuum classes, objects, collections, relations,
  imports, exports, templates, tasks, audit history, and IAM administration.
- Server-side BFF authentication with Valkey-backed sessions.
- Runtime health and readiness endpoints for container orchestration.
- Multi-architecture frontend image, OCI Helm chart, and local Compose
  quickstart for use with an external Hubuum Server.
- Compatibility coverage for Hubuum Server `v0.0.1`.
- Visible immutable build identity in the application shell, login page, and
  health endpoints.

### Security

- Backend bearer tokens remain in the frontend's server-side session store and
  are never stored in browser-readable or `HttpOnly` token cookies.
- The production image and chart run as a non-root user with dropped
  capabilities and read-only root filesystems.

[Unreleased]: https://github.com/hubuum/hubuum-frontend/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/hubuum/hubuum-frontend/releases/tag/v0.0.1
