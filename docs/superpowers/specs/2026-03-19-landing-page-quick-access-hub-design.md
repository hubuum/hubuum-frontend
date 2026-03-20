# Quick Access Hub Landing Page

**Date:** 2026-03-19
**Status:** Draft
**Target:** `/app` route

## Overview

Redesign the landing page (`/app`) from a static action-card grid to a Quick Access Hub that prioritizes user workflow efficiency. The new design surfaces recently accessed items and pinned shortcuts alongside enhanced action cards, enabling users to jump directly to their work.

## Goals

1. **Optimize for common workflows:** Users typically know what they want and need fast access (exact name/ID or recent items)
2. **Support personalization:** Enable users to pin frequently-used classes for quick object creation
3. **Surface recent activity:** Show last-viewed items so users don't need to search repeatedly
4. **Maintain discoverability:** Keep full action cards for exploration and less-common tasks
5. **No backend changes required:** Use `localStorage` for recent history and pins

## User Workflows Addressed

### Primary Workflows
- Jump to a specific object by name/ID (via existing search in topbar)
- Access recently viewed items (new: recent history list)
- Quick-create objects in frequently-used classes (new: pinned shortcuts)
- Browse all available actions (enhanced: current card grid with better visuals)

### Secondary Workflows
- Pin/unpin favorite classes for quick access
- Clear recent history
- Discover available features through action cards

## Layout Structure

### Desktop Layout (≥768px)

Two-column grid: **40% / 60%** split

```
┌─────────────────────────────────────────────────────────┐
│ Left Column (40%)        │ Right Column (60%)           │
│ ─────────────────────────┼──────────────────────────────│
│ Quick Access             │ All Actions                  │
│                          │                              │
│ ┌─ Recent Items ───┐    │ ┌─ Recommended Action ─────┐ │
│ │ • Object: Server │    │ │ [Enhanced card]          │ │
│ │ • Class: Network │    │ └──────────────────────────┘ │
│ │ • Namespace: IT  │    │                              │
│ └──────────────────┘    │ ┌───┬───┐                    │
│                          │ │ A │ B │  [Action cards    │
│ ┌─ Pinned Shortcuts ┐    │ ├───┼───┤   in 2-col grid]  │
│ │ ⭐ Server (IT)   │    │ │ C │ D │                    │
│ │ ⭐ Network (IT)  │    │ ├───┼───┤                    │
│ └──────────────────┘    │ │ E │ F │                    │
│                          │ └───┴───┘                    │
└─────────────────────────────────────────────────────────┘
```

### Mobile Layout (<768px)

Single column, stacked:

```
┌───────────────────────┐
│ Quick Access          │
│ ┌─ Recent Items ───┐ │
│ │ • Object: Server │ │
│ └──────────────────┘ │
│                       │
│ ┌─ Pinned ─────────┐ │
│ │ ⭐ Server (IT)  │ │
│ └──────────────────┘ │
├───────────────────────┤
│ All Actions           │
│ ┌─ Recommended ────┐ │
│ │ [Card]           │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ Action card      │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ Action card      │ │
│ └──────────────────┘ │
└───────────────────────┘
```

## Component Details

### Left Column: Quick Access

Container class: `quick-access-panel`

#### 1. Recent Items Section

**Header:**
- Title: "Recent Items"
- Secondary action: "Clear" link (only shows if items exist)

**List (`recent-items-list`):**
- Last 8-10 accessed items (namespaces, classes, objects)
- Each item shows:
  - Icon (16-20px, based on type: namespace/class/object)
  - Primary text: item name
  - Secondary text: type label + timestamp (e.g., "Object • 2 hours ago")
  - Hover state reveals item ID or breadcrumb context
- Click navigates to detail page
- Items ordered by last-accessed timestamp (most recent first)

**Empty State:**
- Message: "No recent items yet"
- Subtext: "Items you view will appear here for quick access"
- Optional: Link to "Browse namespaces" or "Browse classes"

**Data Source:**
- `localStorage` key: `hubuum.recent-items`
- Structure: `Array<{ type: 'namespace' | 'class' | 'object', id: number, name: string, timestamp: number, classId?: number, namespaceId?: number }>`
- Max entries: 50 (trim oldest when exceeded)
- Update on: namespace/class/object detail page view

#### 2. Pinned Shortcuts Section

**Header:**
- Title: "Pinned Shortcuts"
- Secondary action: "Manage" link (optional, could open edit mode)

**List (`pinned-shortcuts-list`):**
- User-pinned classes for quick object creation
- Each item shows:
  - Class icon (16-20px)
  - Class name
  - Namespace context (small, muted text)
  - Unpin button (X icon, shows on hover)
- Click opens "Create object" modal/flow for that class
- Max 5 pins (prevent clutter)
- Drag-to-reorder (optional future enhancement)

**Empty State:**
- Message: "No pinned classes yet"
- Subtext: "Pin your favorite classes for quick object creation"
- Optional: Link to "Browse classes"

**Data Source:**
- `localStorage` key: `hubuum.pinned-classes`
- Structure: `Array<{ classId: number, className: string, namespaceName: string }>`
- Update on: Pin/unpin action from class detail page or this list
- Pin action available on: class detail pages, class list page

**Visual Style:**
- Light card background (`var(--card)` or slightly lighter)
- Compact spacing (0.5-0.6rem between items)
- Subtle borders between items or card-per-item approach
- Icons use `var(--accent)` color
- Hover state: subtle background change

### Right Column: All Actions

Container class: `all-actions-panel`

#### 1. Recommended Action Card (unchanged logic)

Keep existing logic that determines recommended action based on system state (namespaces → classes → objects progression).

**Enhancements:**
- Add icon at top-left or top-center (24-32px)
- Use distinct visual treatment (different background color, e.g., `var(--accent-soft)`)
- Keep existing two-action-button layout

#### 2. Action Cards Grid

**Layout:**
- 2-column grid on desktop (gap: 1rem)
- 1-column on mobile

**Card Enhancements (per card):**
- Icon at top (24-32px, use `var(--accent)` color)
- Title row: title + count badge (if applicable)
  - Count badge: small pill-style indicator (e.g., "12 objects")
- Description (concise, 1-2 lines)
- Action buttons (primary + optional secondary)

**Cards (in order):**

1. **Set up namespaces**
   - Icon: `<IconNamespace />` (from app-shell.tsx)
   - Count: `${totalNamespaces} namespace${s}`
   - Current description logic

2. **Define classes**
   - Icon: `<IconClass />`
   - Count: `${totalClasses} class${es}`
   - Current description logic

3. **Work with objects**
   - Icon: `<IconObject />`
   - Count: `${totalObjects} object${s}`
   - Current description logic

4. **Connect relations**
   - Icon: `<IconRelation />`
   - Count: none (or class-relation count if available)
   - Current description logic

5. **Build reports**
   - Icon: `<IconReport />`
   - Count: none (or report template count if available)
   - Current description logic

6. **Run imports**
   - Icon: `<IconImport />`
   - Count: active task count if > 0 (e.g., "3 active")
   - Current description logic

7. **Inspect system statistics**
   - Icon: `<IconOverview />`
   - Count: none
   - Current description logic

8. **Manage access** (if `canViewAdmin`)
   - Icon: `<IconUser />` or `<IconUsers />`
   - Count: none (or user/group count if useful)
   - Current description logic

**Visual Style:**
- Keep existing card structure (`.card.stack.action-card`)
- Add icon container at top: `.action-card-icon`
- Title + count row: `.action-card-title-row`
- Count badge: `.action-card-count` (pill-style, muted background)
- Description: `.muted` (existing)
- Actions: `.action-card-actions` (existing)

## Data Flow

### Recent Items

**Update Flow:**
1. User visits namespace/class/object detail page
2. On page load (useEffect in detail component or app-shell):
   - Read current `localStorage.hubuum.recent-items`
   - Add/update entry with current item
   - Remove duplicates (same type + id)
   - Sort by timestamp (most recent first)
   - Trim to max 50 entries
   - Write back to localStorage

**Read Flow:**
1. Landing page loads
2. Read `localStorage.hubuum.recent-items`
3. Take first 8-10 entries
4. Render list

**Clear Flow:**
1. User clicks "Clear" link
2. Confirm dialog (optional)
3. Remove `localStorage.hubuum.recent-items`
4. Re-render empty state

### Pinned Shortcuts

**Pin Flow (from class detail page):**
1. User clicks "Pin this class" button
2. Read current `localStorage.hubuum.pinned-classes`
3. Check if already pinned (skip if yes)
4. Check if max pins reached (show toast if yes)
5. Add entry: `{ classId, className, namespaceName }`
6. Write back to localStorage
7. Show success toast

**Unpin Flow:**
1. User clicks unpin (X) button on pinned item
2. Read current `localStorage.hubuum.pinned-classes`
3. Filter out entry with matching classId
4. Write back to localStorage
5. Re-render list

**Click Flow:**
1. User clicks pinned class item
2. Navigate to `/objects?create=1&classId=${classId}`
3. Opens create object modal with class pre-selected

## Interactions

### Keyboard Shortcuts

Existing shortcuts remain (already handled by app-shell):
- `C`: Open create modal
- `/`: Focus search
- `?`: Keyboard help
- `Esc`: Close modals/deselect

No new shortcuts for this feature.

### Click Targets

**Recent Items:**
- Click item: navigate to detail page
- Click "Clear": confirm + clear history

**Pinned Shortcuts:**
- Click item: open create object flow
- Click unpin (X): remove pin

**Action Cards:**
- Click primary button: navigate to href
- Click secondary button (if present): navigate to href

### Hover States

- Recent items: subtle background change, maybe show ID/breadcrumb
- Pinned items: show unpin button
- Action cards: existing hover states

## Visual Design

### Color Palette (existing CSS variables)

- Background: `var(--bg)`, `var(--bg-strong)`, `var(--bg-highlight)`
- Cards: `var(--card)`
- Text: `var(--ink)`, `var(--muted)`
- Accent: `var(--accent)`, `var(--accent-soft)`
- Borders: `var(--line)`

### Typography

- Section headings: existing `.eyebrow` style
- Card titles: existing `h3` style
- List item primary: 0.9-1rem, font-weight 500
- List item secondary: 0.8rem, `var(--muted)`
- Counts: 0.75-0.8rem, muted

### Spacing

- Column gap: 1.5rem
- Card gap: 1rem
- List item gap: 0.5-0.6rem
- Internal card padding: 1-1.2rem

### Icons

- Recent items: 16-20px
- Pinned items: 16-20px
- Action card icons: 24-32px
- All icons use `var(--accent)` color

## Responsive Behavior

### Desktop (≥768px)
- Two-column layout (40% / 60%)
- Action cards in 2-column grid

### Tablet (768px - 1024px)
- Two-column layout (40% / 60% or adjust to 35% / 65%)
- Action cards in 2-column grid
- May need to reduce font sizes slightly

### Mobile (<768px)
- Single column, stacked
- Quick Access section first
- All Actions section second
- Action cards single column
- Sticky create FAB remains (existing app-shell behavior)

## Empty States

### New User (no namespaces/classes/objects)
- Recent items: empty state message
- Pinned shortcuts: empty state message
- Recommended action: "Start by creating a namespace"
- Action cards: show "no X yet" messaging (existing)

### Active User
- Recent items: populated list
- Pinned shortcuts: may be empty (user hasn't pinned anything yet)
- Recommended action: context-aware (existing logic)
- Action cards: show counts (existing)

## Implementation Notes

### Files to Modify

1. **`src/app/(protected)/app/page.tsx`**
   - Change layout from single section to two-column grid
   - Add Quick Access panel (recent + pinned)
   - Keep All Actions panel (enhanced cards)
   - Add localStorage hooks for recent/pinned data

2. **`src/app/globals.css`**
   - Add `.quick-access-panel` styles
   - Add `.all-actions-panel` styles
   - Add `.recent-items-list` styles
   - Add `.pinned-shortcuts-list` styles
   - Add `.action-card-icon` styles
   - Add `.action-card-title-row` styles
   - Add `.action-card-count` badge styles
   - Add responsive styles for two-column → single-column

3. **Detail pages (namespace/class/object)**
   - Add logic to update `localStorage.hubuum.recent-items` on mount
   - Extract to utility function: `trackRecentItem({ type, id, name, classId?, namespaceId? })`

4. **Class detail page specifically**
   - Add "Pin this class" / "Unpin this class" button
   - Read from `localStorage.hubuum.pinned-classes` to determine state

### New Utility Functions

**`src/lib/recent-items.ts`:**
- `getRecentItems(): RecentItem[]` - read from localStorage
- `trackRecentItem(item: RecentItem): void` - add/update item
- `clearRecentItems(): void` - clear localStorage

**`src/lib/pinned-classes.ts`:**
- `getPinnedClasses(): PinnedClass[]` - read from localStorage
- `pinClass(classId: number, className: string, namespaceName: string): boolean` - add pin, return false if max reached
- `unpinClass(classId: number): void` - remove pin
- `isPinned(classId: number): boolean` - check if pinned

### Type Definitions

```typescript
type RecentItemType = 'namespace' | 'class' | 'object';

interface RecentItem {
  type: RecentItemType;
  id: number;
  name: string;
  timestamp: number;
  classId?: number; // for objects
  namespaceId?: number; // for classes and objects
}

interface PinnedClass {
  classId: number;
  className: string;
  namespaceName: string;
}
```

### localStorage Keys

- `hubuum.recent-items` → `RecentItem[]`
- `hubuum.pinned-classes` → `PinnedClass[]`

### Action Card Count Sources

Counts come from existing `fetchMetaCounts()` call:
- `counts.total_namespaces` or `getTotalNamespaces(counts)`
- `counts.total_classes`
- `counts.total_objects`

Task count from existing task queue query (already in app-shell for badge).

### Accessibility

- Recent items list: `<ul role="list">` with semantic list items
- Pinned shortcuts: `<ul role="list">` with semantic list items
- Clear button: `<button aria-label="Clear recent items">`
- Unpin button: `<button aria-label="Unpin {className}">`
- Action cards: maintain existing accessible structure
- Icons: `aria-hidden="true"` (decorative)

## Future Enhancements (Out of Scope)

- Drag-to-reorder pinned classes
- Recent activity feed (workspace-wide, requires backend)
- Pinned objects (in addition to classes)
- Search/filter within recent items
- Recent items persistence across devices (requires backend)
- Analytics on which action cards are most used

## Success Criteria

1. Users can access last 8-10 viewed items in one click
2. Users can pin up to 5 favorite classes for quick object creation
3. Landing page loads in <500ms (no new API calls)
4. Responsive design works on mobile, tablet, desktop
5. Empty states guide new users to next steps
6. Existing action card functionality preserved
7. No accessibility regressions
