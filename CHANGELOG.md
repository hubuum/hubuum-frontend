# Changelog

All notable changes to Hubuum Frontend are documented in this file.

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2026-07-17

### Compatibility

- Hubuum Frontend `v0.0.2` targets Hubuum Server `v0.0.2`; release checks run
  against the immutable digest published for that server image tag.

### Added

- Admin-only backup and restore workspace with background backup tracking,
  integrity metadata, staged validation, and explicit destructive confirmation.
- Dedicated read-only admin configuration page for the server's redacted
  effective runtime settings.
- Server-persisted shared and personal computed fields with typed operations,
  JSON Pointer inputs, previews, shared rebuilds, and computed values in object
  tables, exports, search, and detail views.
- Configurable object-reachability depth, persisted in the relations URL, for
  exploring paths up to 10 hops.
- Dedicated account appearance settings for theme, density, and primary and
  secondary workspace colors.
- Inline, type-aware editing for object data and direct fields on object,
  class, and collection detail pages.
- Detailed audit-event inspection and administration of event sinks.
- A complete class-relation inventory with contextual filters and clearer
  relation navigation.
- Redesigned export and template-authoring workspaces with query building,
  related-object controls, previews, and Minijinja-aware editing.
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
- Standardized click-to-edit interactions and Escape-to-cancel behavior across
  detail views, menus, forms, and dialogs.
- Updated the dependency baseline and adopted the TypeScript 7 compiler while
  retaining the TypeScript 6 programmatic API required by Next.js.

### Fixed

- Task completion notifications now catch tasks that finish before the first
  poll, ignore old completed-task backlogs, and remain visible above dialogs.

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

[Unreleased]: https://github.com/hubuum/hubuum-frontend/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/hubuum/hubuum-frontend/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/hubuum/hubuum-frontend/releases/tag/v0.0.1
