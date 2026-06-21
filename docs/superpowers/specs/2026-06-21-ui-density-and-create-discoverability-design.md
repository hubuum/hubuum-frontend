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
  - **Use two independent `try/catch` blocks** (one for theme, one for density). A
    failure initializing one must not prevent the other from applying.

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
  font-size: 14.25px;           /* ~89% of the 16px default; conservative start */
}

/* Targeted trims that go beyond proportional scaling */
html[data-density="compact"] input,
html[data-density="compact"] select,
html[data-density="compact"] textarea {
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
}

/* Only normal content/menu/form buttons — NOT fixed-size icon buttons.
   Exclude every fixed-size / padding:0 button class explicitly. */
html[data-density="compact"]
  button:not(.icon-button):not(.fab):not(.sidebar-link-button):not(.topbar-search-clear):not(.topbar-search-submit) {
  padding: 0.55rem 0.8rem;
}

html[data-density="compact"] .content { gap: 0.7rem; }

/* Narrow to data-table surfaces only. Do NOT use `.content .card` — it would also
   catch `.modal-panel.card` and nested cards. */
html[data-density="compact"] .card.table-wrap { padding: 0.75rem; }

html[data-density="compact"] th,
html[data-density="compact"] td { padding: 0.3rem 0.5rem; }
```

Notes:
- Start conservative on the root font-size (14.25px ≈ 89%) since it shrinks *all* rem
  text, not just spacing. The density win comes mostly from the targeted padding
  trims; the root scale can be nudged down later if it still feels too large.
- The `button` override is scoped with `:not(...)` to avoid distorting fixed-size
  icon buttons, FABs, sidebar buttons, and the search clear/submit buttons.
- Card padding is trimmed only on `.card.table-wrap` (the dense data tables).
  General cards rely on proportional rem scaling, and modal panels / nested cards are
  left untouched.
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

**One vocabulary everywhere.** The visible button text, the `aria-label`, and the
`title`/tooltip all use this same "New X" string. The current `getCreateAriaLabel`
("Add …") is replaced by `getCreateLabel` so the UI never says "Add class" in one
place and "New class" in another. (Tooltip on the FAB appends the shortcut: "New
class (C)".)

### Header button

Replace the icon-only `quick-add-button` in the topbar title row
(`app-shell.tsx:1203-1216`) with a **labeled primary button**: `<IconPlus/> New class`.

- Styled as an accent/primary button (not ghost) so it stands out: new class
  `create-button` with icon + text span.
- Stays in the title row so it sits right next to the section heading, matching the
  approved mockup.
- **Crowding / responsive.** The title row already holds context `<select>`s on
  `/objects` and `/relations/objects` (class, and for relations also object), plus the
  topbar carries search + the user menu. The label must not squeeze those.
  - Collapse the header button to **icon-only based on available space, via a
    container query** (not a flat viewport breakpoint) — the label needs to drop
    earlier on the select-heavy routes than on plain list routes, and a container
    query measures the actual space the title row has rather than the whole viewport.
  - Mechanism: set `container-type: inline-size` (+ a `container-name`, e.g.
    `topbar`) on the topbar's left region (`.topbar-left`, which holds the title row
    and context selects). Wrap the create button's text in a span (e.g.
    `.create-button-text`) that is hidden by default-visible and collapsed via
    `@container topbar (max-width: <threshold>) { .create-button-text { display:
    none } }`. The icon stays, so the button shrinks to an icon-only square.
  - This is the codebase's first `@container` usage; threshold to be tuned during
    manual review against `/objects` and `/relations/objects`.
  - The extended FAB is always labeled, so an icon-only header button never leaves the
    user without a worded affordance.
  - If manual testing still shows crowding on `/objects` or `/relations/objects` at
    common laptop widths, fall back to moving the header create button to the right
    edge of the title row (or just below it) rather than inline after the selects.

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
- Responsive / overflow: confirm the topbar does not overflow or wrap awkwardly at
  common **laptop** widths (e.g. 1280, 1366, 1440px), not just mobile — the labeled
  create button competes with the class/object selectors, search field, and user menu
  for horizontal space. Test `/objects` and `/relations/objects` specifically, where
  the title row is most crowded. Verify the container query collapses the header
  button to icon-only before it forces overflow, and the FAB stays labeled.

## Files touched

- `public/theme-init.js` — apply `data-density` before paint.
- `src/components/app-shell.tsx` — density state + menu toggle; labeled header button;
  extended FAB; `getCreateLabel` helper.
- `src/app/globals.css` — compact override block; `.create-button` and
  `.fab--extended` styles.
