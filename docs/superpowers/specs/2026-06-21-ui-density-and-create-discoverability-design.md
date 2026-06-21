# UI Density Toggle & Create Discoverability — Design

Date: 2026-06-21
Status: Proposed

## Problem

Two usability complaints with the current console UI:

1. **Everything is a bit too big.** Controls and cards are chunky, so less content
   fits on screen.
2. **Creating new instances is hard to discover.** The only create affordances are
   icon-only (a small ghost `+` next to the section heading and an accent `+` FAB),
   plus an invisible `C` shortcut. Nothing says the word "New", so returning users
   forget how to create.

## Decisions

- **Density:** add an **opt-in Compact mode**. The current spacing stays the default
  ("Comfortable"); nothing moves for users who don't opt in. Compact is driven by a
  `data-density` attribute on `<html>` that scales the root font-size and tightens a
  few control/card paddings.
- **Create:** keep creation **context-aware per page**, but make both affordances
  **labeled**: a labeled primary button in the section header ("+ New class") and an
  **extended (labeled) FAB** bottom-right. The label follows the active section.

Out of scope (considered, not chosen): a global "+ Create" dropdown, empty-state
CTAs, a command palette, and a forced denser baseline. These can be revisited later.

---

## Part A — Compact density mode

### State, persistence, no-flash init

- New localStorage key `hubuum.density` with values `"comfortable" | "compact"`,
  default `"comfortable"`. Mirrors the existing `hubuum.theme` pattern.
- Applied as `document.documentElement.setAttribute("data-density", value)`.
- Extend `public/theme-init.js` (loaded before paint in `src/app/layout.tsx:18`) to
  also read `hubuum.density` and set `data-density` so there is no flash of the
  comfortable layout on load. Default to `"comfortable"` on any error / missing value.

### AppShell wiring (`src/components/app-shell.tsx`)

- Add `densityPreference` state + setter, mirroring `themePreference`:
  - A `useEffect` that reads `hubuum.density` on mount.
  - A `useEffect` that writes the key and sets the `data-density` attribute whenever
    it changes (same shape as the existing theme effect at lines ~640-666).
- Add a **Density** group to the user menu, directly above the existing Theme group
  (around `app-shell.tsx:1272`), with two `menu-item` buttons: **Comfortable** /
  **Compact**, using the existing `is-selected` styling.

### CSS (`src/app/globals.css`)

Comfortable = current values (no change). Add a Compact override block:

```css
html[data-density="compact"] {
  font-size: 13.5px;            /* ~84% of the 16px default; everything in rem scales */
}

/* Targeted trims that go beyond proportional scaling */
html[data-density="compact"] input,
html[data-density="compact"] select,
html[data-density="compact"] textarea {
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
}
html[data-density="compact"] button {
  padding: 0.55rem 0.8rem;
}
html[data-density="compact"] .content { gap: 0.7rem; }
html[data-density="compact"] .content .card { padding: 0.75rem; }
html[data-density="compact"] th,
html[data-density="compact"] td { padding: 0.3rem 0.5rem; }
```

Notes:
- Because all spacing is already authored in `rem`, the root font-size change does
  most of the work; the targeted overrides squeeze the chunkiest controls further.
- CodeMirror / code editors set their own font-size, so they are unaffected.
- Exact numbers are starting points and may be nudged during manual review.

---

## Part B — Labeled, context-aware create

### Label helper (`src/components/app-shell.tsx`)

Add `getCreateLabel(createSection, relationsView)` returning the "New …" noun phrase:

| Section        | Label                |
|----------------|----------------------|
| namespaces     | New namespace        |
| classes        | New class            |
| objects        | New object           |
| relations      | New class relation / New object relation (per `relationsView`) |
| admin-users    | New user             |
| admin-groups   | New group            |

The existing `getCreateAriaLabel` ("Add …") stays for `aria-label`, or is folded into
the new helper — either is fine as long as the visible text reads "New X".

### Header button

Replace the icon-only `quick-add-button` in the topbar title row
(`app-shell.tsx:1203-1216`) with a **labeled primary button**: `<IconPlus/> New class`.

- Styled as an accent/primary button (not ghost) so it stands out: new class
  `create-button` with icon + text span.
- Stays in the title row so it sits right next to the section heading, matching the
  approved mockup.
- **Responsive:** show the text label at ≥ 720px; collapse to icon-only below 720px
  (reuse the `.desktop-only` / media-query pattern). The extended FAB remains the
  labeled affordance on small screens.

### Extended FAB

Convert the existing create FAB (`app-shell.tsx:1342-1356`) from a round icon button
to an **extended pill**: `<IconPlus/> <span>New class</span>`.

- New `.fab--extended` styles: `width: auto`, pill `border-radius`, horizontal
  padding, `gap` between icon and label, label in a span.
- Keep the `C` shortcut and the `title` tooltip (now `"New class (C)"`).
- The **delete** FAB (`.fab--delete`) is unchanged (icon + count badge).

### Unchanged

- Routes without a `createSection` (Home, Reports, Imports, Tasks, Search,
  Statistics, Account) show no create button — they aren't instance-creation pages.
- The `OPEN_CREATE_EVENT` dispatch flow and the create modals are untouched; only the
  triggers' appearance changes.

---

## Testing / Verification

No automated UI test suite exists in this repo, so verification is manual plus the
standard checks:

- `npm run lint`, `npm run typecheck`, `npm run build` all pass.
- Density: toggle Comfortable ↔ Compact; confirm it persists across reload with **no
  flash** of the comfortable layout; confirm both Light and Dark themes look right;
  confirm tables/forms/code editors remain usable in Compact.
- Create: on each of namespaces / classes / objects / relations (both views) /
  admin users / admin groups, confirm the header button and FAB both read the correct
  "New X" label, both open the right modal, and the `C` shortcut still works.
- Responsive: header button collapses to icon-only under 720px; FAB stays labeled.

## Files touched

- `public/theme-init.js` — apply `data-density` before paint.
- `src/components/app-shell.tsx` — density state + menu toggle; labeled header button;
  extended FAB; `getCreateLabel` helper.
- `src/app/globals.css` — compact override block; `.create-button` and
  `.fab--extended` styles.
