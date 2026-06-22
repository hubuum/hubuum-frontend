# UI Density Toggle & Create Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Compact density mode and make "create new instance" affordances obvious by labeling them.

**Architecture:** A `data-density` attribute on `<html>` (mirroring the existing `data-theme` pattern) drives Compact CSS overrides; the preference is persisted in `localStorage` and applied pre-paint in `theme-init.js`. The create affordances stay context-aware but become labeled: a primary "New X" button in the topbar title row (collapsing to icon-only via a container query) and an extended labeled FAB. All create-trigger UI lives in `app-shell.tsx`; the modal flow is untouched.

**Tech Stack:** Next.js 16 / React 19, plain CSS in `src/app/globals.css`, Biome (lint), `tsc` (typecheck). **No automated test runner exists** in this repo — verification is `npm run lint`, `npm run typecheck`, `npm run build`, plus manual browser checks.

## Global Constraints

- Comfortable density = current spacing, **unchanged**. Compact is strictly additive (`html[data-density="compact"]` overrides only).
- `localStorage` key: `hubuum.density`; values `"comfortable" | "compact"`; default `"comfortable"`.
- No flash of the comfortable layout on load — density must be applied in `theme-init.js` before paint, in a `try/catch` **independent** of the theme block.
- Create vocabulary is one string everywhere: visible text, `aria-label`, and `title` all read "New X" (the FAB `title` appends " (C)").
- Compact `button` padding override must **exclude** every fixed-size / `padding:0` button: `.icon-button`, `.fab`, `.sidebar-link-button`, `.topbar-search-clear`, `.topbar-search-submit`.
- Compact card-padding trim targets `.card.table-wrap` only — never `.content .card` (would catch `.modal-panel.card` and nested cards).
- Container query is the codebase's first `@container` usage; the FAB stays labeled at all widths as the guaranteed worded affordance.
- Commit after each task.

---

### Task 1: Density preference plumbing + no-flash init + menu toggle

**Files:**
- Modify: `public/theme-init.js` (whole file)
- Modify: `src/components/app-shell.tsx` (constants ~`56-57`; state ~`595-596`; init effect ~`621-631`; apply effect — new; user menu ~`1272-1295`)

**Interfaces:**
- Consumes: nothing.
- Produces: `data-density` attribute on `document.documentElement` (`"comfortable" | "compact"`), persisted at `localStorage["hubuum.density"]`. Task 2 consumes the attribute via CSS.

- [ ] **Step 1: Rewrite `public/theme-init.js` with two independent guarded blocks**

Replace the entire file with:

```js
(() => {
	try {
		const key = "hubuum.theme";
		const stored = window.localStorage.getItem(key);
		const preference =
			stored === "light" || stored === "dark" || stored === "system"
				? stored
				: "system";
		const resolved =
			preference === "system"
				? window.matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light"
				: preference;
		document.documentElement.setAttribute("data-theme", resolved);
		document.documentElement.style.colorScheme = resolved;
	} catch {
		// Ignore theme init errors and keep CSS defaults.
	}

	try {
		const key = "hubuum.density";
		const stored = window.localStorage.getItem(key);
		const density = stored === "compact" ? "compact" : "comfortable";
		document.documentElement.setAttribute("data-density", density);
	} catch {
		// Ignore density init errors and keep CSS defaults.
	}
})();
```

- [ ] **Step 2: Add the density key constant in `app-shell.tsx`**

After the existing keys (around line 56-57):

```ts
const SIDEBAR_COLLAPSED_KEY = "hubuum.sidebar.collapsed";
const THEME_PREFERENCE_KEY = "hubuum.theme";
const DENSITY_PREFERENCE_KEY = "hubuum.density";
```

- [ ] **Step 3: Add a density type + state**

Near the `ThemePreference` type (line 47), add:

```ts
type DensityPreference = "comfortable" | "compact";
```

Next to the theme state (around line 595-596), add:

```ts
const [densityPreference, setDensityPreference] =
	useState<DensityPreference>("comfortable");
```

- [ ] **Step 4: Read the stored density on mount**

In the existing mount effect that reads sidebar + theme (around line 621-631), append, before the closing `}, []);`:

```ts
const storedDensity = window.localStorage.getItem(DENSITY_PREFERENCE_KEY);
if (storedDensity === "compact" || storedDensity === "comfortable") {
	setDensityPreference(storedDensity);
}
```

- [ ] **Step 5: Persist + apply density on change**

Add a new effect immediately after the theme effect (after the block ending around line 666):

```ts
useEffect(() => {
	window.localStorage.setItem(DENSITY_PREFERENCE_KEY, densityPreference);
	document.documentElement.setAttribute("data-density", densityPreference);
}, [densityPreference]);
```

- [ ] **Step 6: Add the Density group to the user menu**

In the user menu, immediately before the existing `<div className="menu-group">` that contains the Theme buttons (around line 1272), insert:

```tsx
<div className="menu-group">
	<p className="menu-label">Density</p>
	<button
		type="button"
		className={`menu-item ${densityPreference === "comfortable" ? "is-selected" : ""}`}
		onClick={() => setDensityPreference("comfortable")}
	>
		Comfortable
	</button>
	<button
		type="button"
		className={`menu-item ${densityPreference === "compact" ? "is-selected" : ""}`}
		onClick={() => setDensityPreference("compact")}
	>
		Compact
	</button>
</div>
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both pass, no errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open the app, open the user menu.
Expected:
- Density group shows above Theme with Comfortable selected.
- Click Compact → in devtools, `<html data-density="compact">`; `localStorage["hubuum.density"] === "compact"`.
- Reload → still Compact, and `data-density="compact"` is present on first paint (no flicker; verify by throttling or watching the Elements panel during reload).

- [ ] **Step 9: Commit**

```bash
git add public/theme-init.js src/components/app-shell.tsx
git commit -m "Add density preference state, no-flash init, and menu toggle"
```

---

### Task 2: Compact CSS overrides

**Files:**
- Modify: `src/app/globals.css` (append a new block at end of file)

**Interfaces:**
- Consumes: `html[data-density="compact"]` set by Task 1.
- Produces: visual Compact mode. No exports.

- [ ] **Step 1: Append the Compact override block to `globals.css`**

Add at the end of the file:

```css
/* ---------- Compact density (opt-in) ---------- */
/* Comfortable = default values above. Compact is strictly additive. */
html[data-density="compact"] {
	font-size: 14.25px; /* ~89% of 16px; all rem spacing scales. Conservative start. */
}

html[data-density="compact"] input,
html[data-density="compact"] select,
html[data-density="compact"] textarea {
	padding: 0.5rem 0.65rem;
	border-radius: 10px;
}

/* Normal content/menu/form buttons only — exclude fixed-size icon buttons. */
html[data-density="compact"]
	button:not(.icon-button):not(.fab):not(.sidebar-link-button):not(.topbar-search-clear):not(.topbar-search-submit) {
	padding: 0.55rem 0.8rem;
}

html[data-density="compact"] .content {
	gap: 0.7rem;
}

/* Data-table surfaces only — never `.content .card` (catches modal panels). */
html[data-density="compact"] .card.table-wrap {
	padding: 0.75rem;
}

html[data-density="compact"] th,
html[data-density="compact"] td {
	padding: 0.3rem 0.5rem;
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Toggle Compact (from Task 1). Visit `/classes` (a table page) and any page with a form/modal.
Expected:
- Tables and form controls visibly tighten; more rows fit.
- Open a create modal → the modal panel padding is **not** crushed (selector excluded it).
- Icon buttons (topbar search submit/clear, sidebar collapse, FAB) keep their shape (not distorted).
- Toggle back to Comfortable → layout is byte-for-byte the previous look.
- Check both Light and Dark themes.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "Add compact density CSS overrides"
```

---

### Task 3: Labeled, context-aware header create button + container query

**Files:**
- Modify: `src/components/app-shell.tsx` (replace `getCreateAriaLabel` ~`210-235`; replace header create button ~`1203-1216`; update FAB `aria-label`/`title` call sites at ~`1347-1352` to use the new helper — FAB markup itself is rebuilt in Task 4)
- Modify: `src/app/globals.css` (add `.create-button` styles + `.topbar` container + `@container` rule)

**Interfaces:**
- Consumes: `createSection`, `relationsView`, `sectionLabel` (already computed in the component).
- Produces: `getCreateLabel(createSection, relationsView): string` returning the "New X" phrase. Task 4 consumes `getCreateLabel`.

- [ ] **Step 1: Replace `getCreateAriaLabel` with `getCreateLabel`**

Replace the whole `getCreateAriaLabel` function (around line 210-235) with:

```ts
function getCreateLabel(
	createSection: CreateSection,
	relationsView: "classes" | "objects" | null,
): string {
	if (createSection === "relations") {
		return `New ${relationsView === "objects" ? "object relation" : "class relation"}`;
	}
	if (createSection === "admin-users") {
		return "New user";
	}
	if (createSection === "admin-groups") {
		return "New group";
	}
	if (createSection === "namespaces") {
		return "New namespace";
	}
	if (createSection === "classes") {
		return "New class";
	}
	if (createSection === "objects") {
		return "New object";
	}

	return "New item";
}
```

Note: the `sectionLabel` parameter is dropped (every section now has an explicit noun). The fallback `"New item"` is unreachable for real `CreateSection` values but satisfies the return type.

- [ ] **Step 2: Replace the header create button markup**

Replace the header create button block (around line 1203-1216) with:

```tsx
{createSection ? (
	<button
		type="button"
		className="create-button"
		onClick={openCreateModal}
		aria-label={getCreateLabel(createSection, relationsView)}
		title={getCreateLabel(createSection, relationsView)}
	>
		<IconPlus />
		<span className="create-button-text">
			{getCreateLabel(createSection, relationsView)}
		</span>
	</button>
) : null}
```

- [ ] **Step 3: Update the FAB call sites to the new helper (markup rebuilt in Task 4)**

In the FAB block (around line 1342-1356), change the two `getCreateAriaLabel(createSection, relationsView, sectionLabel)` calls to `getCreateLabel(createSection, relationsView)` so the file compiles after Step 1. (Task 4 replaces this whole block; this step only keeps the build green between tasks.)

```tsx
aria-label={getCreateLabel(createSection, relationsView)}
title={`${getCreateLabel(createSection, relationsView)} (C)`}
```

- [ ] **Step 4: Add `.create-button` styles and the container query to `globals.css`**

Add after the `.quick-add-button` rule (around line 592). (The `.quick-add-button` rule itself is now unused; leave it or delete it — deleting is cleaner:)

```css
.create-button {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.4rem 0.7rem;
	border-radius: 10px;
	background: var(--accent);
	color: #fff;
	font-weight: 600;
	font-size: 0.9rem;
	white-space: nowrap;
	flex: 0 0 auto;
}

.create-button svg {
	width: 1.05rem;
	height: 1.05rem;
}

.create-button-text {
	white-space: nowrap;
}

/* Collapse the header create label when the topbar is tight.
   The extended FAB remains the always-labeled affordance. */
@container topbar (max-width: 560px) {
	.create-button-text {
		display: none;
	}
	.create-button {
		padding: 0.4rem 0.5rem;
	}
}
```

Then make the topbar a query container by adding `container` declarations to the existing `.topbar` rule (around line 450-456):

```css
.topbar {
	padding: 0.45rem 0.65rem;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	container-type: inline-size;
	container-name: topbar;
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both pass. (Confirms no remaining `getCreateAriaLabel` references and no unused-symbol errors.)

- [ ] **Step 6: Manual verification**

Run: `npm run dev`.
Expected:
- On `/namespaces`, `/classes`, `/objects`, `/relations/classes`, `/relations/objects`, `/admin/users`, `/admin/groups`: the header shows a solid accent button reading the correct "New X" (relations shows "New class relation" vs "New object relation" per view).
- Clicking it opens the correct create modal.
- Narrow the window: the header label disappears (icon-only) before the topbar overflows; widen → label returns.
- Check `/objects` and `/relations/objects` at ~1280/1366/1440px: no topbar overflow/wrap; selects + search + user menu all fit.

- [ ] **Step 7: Commit**

```bash
git add src/components/app-shell.tsx src/app/globals.css
git commit -m "Replace icon-only create button with labeled, container-collapsing button"
```

---

### Task 4: Extended (labeled) FAB

**Files:**
- Modify: `src/components/app-shell.tsx` (create FAB block ~`1342-1356`)
- Modify: `src/app/globals.css` (`.fab` area ~`2002-2059`; FAB mobile `@media` ~`2667-2677`)

**Interfaces:**
- Consumes: `getCreateLabel` (Task 3), `createSection`, `relationsView`, `selectionCount`, `deleteHandler`.
- Produces: extended labeled create FAB. Delete FAB unchanged.

- [ ] **Step 1: Rebuild the create FAB as an extended pill**

Replace the create FAB branch (the `: createSection ? (...)` arm around line 1342-1356) with:

```tsx
) : createSection ? (
	<button
		type="button"
		className="fab fab--extended"
		onClick={openCreateModal}
		aria-label={getCreateLabel(createSection, relationsView)}
		title={`${getCreateLabel(createSection, relationsView)} (C)`}
	>
		<IconPlus />
		<span className="fab-text">{getCreateLabel(createSection, relationsView)}</span>
	</button>
) : null}
```

(The delete FAB branch above it is unchanged.)

- [ ] **Step 2: Add extended-FAB styles to `globals.css`**

After the `.fab svg` rule (around line 2029), add:

```css
.fab--extended {
	width: auto;
	min-width: 3.5rem;
	border-radius: 999px;
	padding: 0 1.1rem;
	gap: 0.45rem;
}

.fab-text {
	font-weight: 600;
	font-size: 0.95rem;
	white-space: nowrap;
}
```

- [ ] **Step 3: Keep the FAB compact on small screens**

In the mobile `@media` block, after the existing `.fab` override (around line 2667-2672), add a rule that drops back to a round icon-only FAB so it doesn't span the screen:

```css
	.fab--extended {
		padding: 0;
		width: 3rem;
		min-width: 0;
		border-radius: 50%;
	}

	.fab--extended .fab-text {
		display: none;
	}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both pass.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`.
Expected:
- On each create-enabled route the bottom-right FAB is a pill reading the correct "New X".
- Hover tooltip shows "New X (C)"; pressing `C` opens the modal.
- Select rows in a table → the FAB switches to the round red delete FAB with count badge (unchanged behavior).
- Shrink to mobile width → the create FAB becomes a round icon-only button (no label).
- Check both themes.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/app-shell.tsx src/app/globals.css
git commit -m "Make create FAB an extended labeled pill"
```

---

## Self-Review

**Spec coverage:**
- Density opt-in + key/default/attribute → Task 1. ✓
- No-flash init with independent try/catch → Task 1 Step 1. ✓
- Menu toggle above Theme → Task 1 Step 6. ✓
- Compact CSS: conservative font-size, scoped button `:not()`, `.card.table-wrap` only, table cell trims → Task 2. ✓
- "New X" vocabulary unified across text/aria/title → Task 3 Step 1-2, Task 4 Step 1. ✓
- Labeled header button replacing icon-only → Task 3. ✓
- Container query collapse + topbar as container → Task 3 Step 4. ✓
- Extended labeled FAB + delete FAB unchanged + mobile collapse → Task 4. ✓
- Verification incl. laptop-width overflow on `/objects` + `/relations/objects` → Task 3 Step 6. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; no "add error handling" hand-waves.

**Type consistency:** `getCreateLabel(createSection, relationsView)` signature is identical in Tasks 3 and 4. `DensityPreference` / `DENSITY_PREFERENCE_KEY` / `densityPreference` consistent across Task 1. `data-density` value strings (`"comfortable" | "compact"`) match between `theme-init.js`, the React state, and the CSS attribute selector.

**Note on TDD:** This repo has no test runner, so tasks substitute static checks (`typecheck`/`lint`/`build`) and concrete manual browser steps for unit tests. This is intentional given the CSS/JSX-only surface.
