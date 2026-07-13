# Changelog

All notable changes to Hubuum Frontend are documented in this file.

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Configurable object-reachability depth, persisted in the relations URL, for
  exploring paths up to 10 hops.
- Dedicated account appearance settings for theme, density, and primary and
  secondary workspace colors.
- Playwright browser-quality coverage for accessibility, color contrast,
  responsive layouts, and visual regression, with portable checks enforced in
  CI.

### Changed

- Simplified related-object cards to emphasize the object, description, hop
  count, and indirect route without displaying object data previews.
- Improved the responsive application shell with mobile search, a single
  primary create action, clearer account controls, and more useful non-admin
  dashboard summaries.
- Made collection, class, and object tables easier to use on narrow screens
  with scroll guidance, sticky identifying columns, combined column controls,
  and accessible sorting.
- Improved action contrast, touch targets, compact typography, and dialog focus
  management across light and dark themes.

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
