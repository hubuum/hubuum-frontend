# Pin System Enhancements

**Date:** 2026-03-19
**Status:** Approved

## Overview

Enhance the Quick Access Hub pin system to support multiple entity types (namespaces, classes, objects) with action-based pinning for classes. Replace the current class-only pin button with a smaller inline icon, add pin action selection for classes, and unify the pinned items display.

## Goals

1. Allow pinning of namespaces, classes, and objects (not just classes)
2. Make pin button smaller and inline with entity names
3. For classes: let users choose between "view objects" or "create object" actions when pinning
4. Support pinning the same class twice (once per action)
5. Increase total pin limit to 10 items across all entity types
6. Display entity name only in Quick Access Panel, with tooltips showing context

## Data Model

### Types (`src/types/quick-access.ts`)

```typescript
export type PinnedItemType = "namespace" | "class" | "object";
export type ClassPinAction = "view" | "create";

export interface PinnedItem {
  type: PinnedItemType;
  id: number; // namespace/class/object ID
  name: string; // entity name only (for display)
  timestamp: number; // when pinned

  // Type-specific fields (discriminated union pattern)
  namespaceId?: number; // for class and object pins
  namespaceName?: string; // for class and object pins (tooltip)
  classId?: number; // for object pins
  className?: string; // for object pins (tooltip)
  action?: ClassPinAction; // only for class pins
}
```

### Storage

- **localStorage key:** `hubuum.pinned-items`
- **Max limit:** 10 items total across all types
- **Sorting:** By timestamp (newest first)
- **Deduplication:**
  - Namespaces: `type + id`
  - Classes: `type + id + action` (same class can be pinned twice with different actions)
  - Objects: `type + id`

### Migration Strategy

On first load, `getPinnedItems()` checks for old `hubuum.pinned-classes` data:
- Convert `PinnedClass[]` to `PinnedItem[]` with `action: "create"` (preserving current behavior)
- Write to `hubuum.pinned-items`
- Delete `hubuum.pinned-classes`
- Migration runs once automatically

## UI Changes

### Pin Button Appearance

**Current:** Full button with 24×24 icon and text label ("Pin class" / "Unpin") below entity header

**New:** Small inline icon button immediately after entity name
- Icon size: 16×16px
- Style: Ghost button, no border, subtle hover state
- Positioned inline with name text using flex layout
- Visual state:
  - Unpinned: Outline/empty pin icon
  - Pinned: Filled pin icon

### Pin Button Behavior

#### Classes
- Click pin icon → dropdown menu appears
- Menu options:
  - "View objects in {className}"
  - "Create object in {className}"
- If already pinned:
  - Shows current action(s) with checkmarks
  - Can select additional action or unpin existing
- If both actions pinned: Both shown checked in menu
- Menu closes on selection or click outside

#### Namespaces
- Click pin icon → immediately toggles pin state (no menu)
- Direct navigation to namespace detail page

#### Objects
- Click pin icon → immediately toggles pin state (no menu)
- Direct navigation to object detail page

### Limit Enforcement

When at 10-pin limit and attempting to pin new item:
- Show alert: "Maximum 10 items can be pinned. Unpin one to add another."
- Do not add the pin

## Quick Access Panel Display

### Pinned Shortcuts Section

**Single unified list** showing all pinned items:
- Sorted by timestamp (most recently pinned first)
- Max 10 items displayed

**Display pattern per entity type:**

#### Namespace Pins
- Icon: Namespace icon
- Primary text: Namespace name only
- No tooltip
- Click → `/namespaces/{id}`
- Unpin button (X) on right

#### Class Pins
- Icon: Class icon
- Primary text: Class name only
- Badge: "view" or "create" next to name
- Tooltip: Namespace name
- Click → Navigate based on action:
  - `view` → `/objects?classId={classId}`
  - `create` → `/objects?create=1&classId={classId}`
- Unpin button (X) on right
- If same class pinned with both actions: Shows as 2 separate list items

#### Object Pins
- Icon: Object icon
- Primary text: Object name only
- Tooltip: "{namespaceName} > {className}"
- Click → `/objects/{classId}/{id}`
- Unpin button (X) on right

### Empty State
```
No pinned items yet
Pin your favorite namespaces, classes, and objects for quick access
```

## Component Architecture

### New Components

#### `src/components/pin-button.tsx` (Client)
Generic pin button component that adapts to entity type.

**Props:**
```typescript
interface PinButtonProps {
  type: PinnedItemType;
  id: number;
  name: string;
  namespaceId?: number;
  namespaceName?: string;
  classId?: number;
  className?: string;
}
```

**Behavior:**
- Manages pin state and menu state (for classes)
- Handles pin/unpin logic via utilities
- Renders inline icon button
- For classes: includes menu trigger and positioning
- For namespace/object: simple toggle

#### `src/components/pin-menu.tsx` (Client)
Dropdown menu for class pin action selection.

**Features:**
- Shows "View objects" and "Create object" options
- Indicates currently pinned actions with checkmarks
- Closes on selection or click outside
- Positioned below/beside pin button

### Modified Components

#### `src/components/quick-access-panel.tsx`
- Replace `pinnedClasses` state with `pinnedItems`
- Update rendering to handle all three entity types
- Add badge rendering for class pins ("view" / "create")
- Implement tooltips:
  - None for namespaces
  - Namespace name for classes
  - "{namespace} > {class}" for objects
- Update navigation logic based on entity type and action
- Update unpin handler to pass action for classes

#### `src/components/class-detail.tsx`
- Remove `ClassDetailActions` component
- Add inline `PinButton` component immediately after class name in header
- Pass all required props (id, name, namespaceId, namespaceName)

#### `src/components/namespace-detail.tsx`
- Add inline `PinButton` component after namespace name in header
- Pass namespace-specific props

#### `src/components/object-detail.tsx`
- Add inline `PinButton` component after object name in header
- Pass object-specific props (including namespace and class info)

### Utilities

#### `src/lib/pinned-items.ts` (New, replaces `pinned-classes.ts`)

**Functions:**
```typescript
// Get all pinned items (includes migration logic)
function getPinnedItems(): PinnedItem[]

// Pin an item (handles deduplication and limit)
function pinItem(item: Omit<PinnedItem, 'timestamp'>): boolean

// Unpin an item (action param only for classes)
function unpinItem(type: PinnedItemType, id: number, action?: ClassPinAction): void

// Check if item is pinned (action param only for classes)
function isPinned(type: PinnedItemType, id: number, action?: ClassPinAction): boolean
```

**Migration logic:** First call to `getPinnedItems()` checks for old data and migrates automatically.

#### `src/lib/pinned-classes.ts`
Delete after migration is stable and tested.

## Navigation Behavior

### Class Pins
- Action "view": Navigate to `/objects?classId={classId}` (objects list filtered by class)
- Action "create": Navigate to `/objects?create=1&classId={classId}` (create object dialog)

### Namespace Pins
- Navigate to `/namespaces/{id}` (namespace detail page)

### Object Pins
- Navigate to `/objects/{classId}/{id}` (object detail page)

## CSS Updates

New styles needed in `src/app/globals.css`:

- `.pin-button-inline` - Small inline icon button styles
- `.pin-menu` - Dropdown menu container
- `.pin-menu-option` - Menu option styles
- `.pin-menu-option.checked` - Checked state with checkmark
- `.pinned-item-badge` - Badge for "view" / "create" indicators
- Update `.pinned-item-link` to accommodate badge
- Adjust spacing for inline pin buttons in detail headers

## Testing Considerations

### Migration Testing
- Verify old `hubuum.pinned-classes` data converts correctly
- Ensure migration only runs once
- Test with various edge cases (empty, max limit, malformed data)

### Pin Behavior Testing
- Test 10-pin limit enforcement across entity types
- Verify class can be pinned twice (once per action)
- Test pin/unpin for each entity type
- Verify menu behavior for classes
- Test navigation for each pin type and action

### UI Testing
- Verify pin button inline positioning on all detail pages
- Test menu positioning and click-outside behavior
- Verify tooltips show correct content
- Test badge display for class pins
- Verify responsive behavior on mobile

### Accessibility
- Ensure pin button has proper aria-label
- Verify keyboard navigation works for menu
- Test screen reader announcements for pin/unpin actions
- Ensure tooltips are keyboard accessible

## Success Criteria

1. Pin button appears inline with entity names at 16×16px size
2. Users can pin namespaces, classes, and objects
3. Class pins show menu with "view" and "create" options
4. Same class can be pinned twice with different actions
5. Quick Access Panel shows unified list of up to 10 pins
6. Entity names only shown; tooltips provide context
7. Class pins show "view" or "create" badge
8. Old pinned classes data migrates automatically
9. All navigation works as specified
10. TypeScript compilation and linter pass
