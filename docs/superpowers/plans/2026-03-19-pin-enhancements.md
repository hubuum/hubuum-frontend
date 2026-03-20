# Pin System Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance Quick Access Hub to support pinning namespaces, classes (with action selection), and objects with unified 10-item limit

**Architecture:** Unified data model with discriminated union types, generic PinButton component that adapts behavior by entity type, dropdown menu for class action selection, migration from old class-only system

**Tech Stack:** React 18, TypeScript, Next.js 16 App Router, localStorage, CSS custom properties

---

## File Structure

### New Files
- `src/types/quick-access.ts` - Extended with `PinnedItem` types (modify existing)
- `src/lib/pinned-items.ts` - Unified pin storage utilities with migration
- `src/components/pin-button.tsx` - Generic inline pin button component
- `src/components/pin-menu.tsx` - Class action selection dropdown

### Modified Files
- `src/components/quick-access-panel.tsx` - Handle all pin types, update display
- `src/components/class-detail.tsx` - Replace ClassDetailActions with inline PinButton
- `src/components/namespace-detail.tsx` - Add inline PinButton to header
- `src/components/object-detail.tsx` - Add inline PinButton to header
- `src/app/globals.css` - Add styles for pin button, menu, badges

### Files to Delete (after migration stable)
- `src/lib/pinned-classes.ts`
- `src/components/class-detail-actions.tsx`

---

## Task 1: Update Type Definitions

**Files:**
- Modify: `src/types/quick-access.ts`

- [ ] **Step 1: Add new types to quick-access.ts**

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

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors, new types available

- [ ] **Step 3: Commit type definitions**

```bash
git add src/types/quick-access.ts
git commit -m "feat: add PinnedItem types for unified pin system

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Create Pinned Items Utilities

**Files:**
- Create: `src/lib/pinned-items.ts`

- [ ] **Step 1: Write utility functions with migration logic**

```typescript
import type { PinnedClass } from "@/types/quick-access";
import type { PinnedItem, PinnedItemType, ClassPinAction } from "@/types/quick-access";

const PINNED_ITEMS_KEY = "hubuum.pinned-items";
const PINNED_CLASSES_KEY = "hubuum.pinned-classes"; // old key for migration
const MAX_PINNED_ITEMS = 10;

// Migration: Convert old PinnedClass[] to new PinnedItem[]
function migrateOldPinnedClasses(): PinnedItem[] | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const oldData = window.localStorage.getItem(PINNED_CLASSES_KEY);
		if (!oldData) {
			return null;
		}

		const oldClasses = JSON.parse(oldData) as PinnedClass[];
		if (!Array.isArray(oldClasses)) {
			return null;
		}

		const migrated: PinnedItem[] = oldClasses.map((old) => ({
			type: "class" as const,
			id: old.classId,
			name: old.className,
			timestamp: Date.now(),
			namespaceId: undefined,
			namespaceName: old.namespaceName,
			action: "create" as const, // preserve current behavior
		}));

		window.localStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify(migrated));
		window.localStorage.removeItem(PINNED_CLASSES_KEY);

		return migrated;
	} catch {
		return null;
	}
}

export function getPinnedItems(): PinnedItem[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(PINNED_ITEMS_KEY);
		if (!stored) {
			const migrated = migrateOldPinnedClasses();
			return migrated ?? [];
		}

		const items = JSON.parse(stored) as PinnedItem[];
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
}

export function pinItem(item: Omit<PinnedItem, "timestamp">): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	try {
		const existing = getPinnedItems();

		// Deduplication logic
		const isDuplicate = existing.some((existingItem) => {
			if (existingItem.type !== item.type || existingItem.id !== item.id) {
				return false;
			}
			// For classes, check action too (same class can be pinned twice with different actions)
			if (item.type === "class") {
				return existingItem.action === item.action;
			}
			return true;
		});

		if (isDuplicate) {
			return false;
		}

		if (existing.length >= MAX_PINNED_ITEMS) {
			return false;
		}

		const newItem: PinnedItem = {
			...item,
			timestamp: Date.now(),
		};

		const updated = [newItem, ...existing];
		window.localStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify(updated));
		return true;
	} catch {
		return false;
	}
}

export function unpinItem(
	type: PinnedItemType,
	id: number,
	action?: ClassPinAction,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const existing = getPinnedItems();
		const filtered = existing.filter((item) => {
			if (item.type !== type || item.id !== id) {
				return true;
			}
			// For classes, match action too
			if (type === "class" && action !== undefined) {
				return item.action !== action;
			}
			return false;
		});

		window.localStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify(filtered));
	} catch {
		// Silently fail
	}
}

export function isPinned(
	type: PinnedItemType,
	id: number,
	action?: ClassPinAction,
): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const items = getPinnedItems();
	return items.some((item) => {
		if (item.type !== type || item.id !== id) {
			return false;
		}
		// For classes, check action too
		if (type === "class" && action !== undefined) {
			return item.action === action;
		}
		return true;
	});
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Test migration in browser console (manual)**

1. Add old format data: `localStorage.setItem('hubuum.pinned-classes', JSON.stringify([{classId:1,className:"Test",namespaceName:"NS"}]))`
2. Call `getPinnedItems()` - should return migrated format
3. Verify old key deleted

- [ ] **Step 4: Commit pinned items utilities**

```bash
git add src/lib/pinned-items.ts
git commit -m "feat: add unified pinned items utilities with migration

Supports namespaces, classes, and objects with 10-item limit.
Migrates old pinned-classes data automatically.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Create Pin Menu Component

**Files:**
- Create: `src/components/pin-menu.tsx`

- [ ] **Step 1: Write PinMenu component**

```typescript
"use client";

import { useEffect, useRef } from "react";
import type { ClassPinAction } from "@/types/quick-access";

interface PinMenuProps {
	isOpen: boolean;
	onClose: () => void;
	className: string;
	viewPinned: boolean;
	createPinned: boolean;
	onToggleView: () => void;
	onToggleCreate: () => void;
}

export function PinMenu({
	isOpen,
	onClose,
	className,
	viewPinned,
	createPinned,
	onToggleView,
	onToggleCreate,
}: PinMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				onClose();
			}
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [isOpen, onClose]);

	if (!isOpen) {
		return null;
	}

	return (
		<div ref={menuRef} className="pin-menu" role="menu">
			<button
				type="button"
				className={`pin-menu-option ${viewPinned ? "pin-menu-option--checked" : ""}`}
				onClick={onToggleView}
				role="menuitem"
			>
				<span className="pin-menu-check">{viewPinned ? "✓" : ""}</span>
				<span>View objects in {className}</span>
			</button>
			<button
				type="button"
				className={`pin-menu-option ${createPinned ? "pin-menu-option--checked" : ""}`}
				onClick={onToggleCreate}
				role="menuitem"
			>
				<span className="pin-menu-check">{createPinned ? "✓" : ""}</span>
				<span>Create object in {className}</span>
			</button>
		</div>
	);
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit pin menu component**

```bash
git add src/components/pin-menu.tsx
git commit -m "feat: add PinMenu component for class action selection

Dropdown menu with view/create options and checkmarks.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Create Pin Button Component

**Files:**
- Create: `src/components/pin-button.tsx`

- [ ] **Step 1: Write PinButton component**

```typescript
"use client";

import { useEffect, useState } from "react";
import { PinMenu } from "@/components/pin-menu";
import { isPinned, pinItem, unpinItem } from "@/lib/pinned-items";
import type { PinnedItemType, ClassPinAction } from "@/types/quick-access";

interface PinButtonProps {
	type: PinnedItemType;
	id: number;
	name: string;
	namespaceId?: number;
	namespaceName?: string;
	classId?: number;
	className?: string;
}

function IconPin({ filled }: { filled: boolean }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" className="pin-icon">
			{filled ? (
				<path
					d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2z"
					fill="currentColor"
				/>
			) : (
				<path
					d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2zm-6 2H7.83L9 12.83V4h6v8.83L16.17 14z"
					fill="currentColor"
				/>
			)}
		</svg>
	);
}

export function PinButton({
	type,
	id,
	name,
	namespaceId,
	namespaceName,
	classId,
	className,
}: PinButtonProps) {
	const [viewPinned, setViewPinned] = useState(false);
	const [createPinned, setCreatePinned] = useState(false);
	const [namespacePinned, setNamespacePinned] = useState(false);
	const [objectPinned, setObjectPinned] = useState(false);
	const [isMenuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		if (type === "class") {
			setViewPinned(isPinned("class", id, "view"));
			setCreatePinned(isPinned("class", id, "create"));
		} else if (type === "namespace") {
			setNamespacePinned(isPinned("namespace", id));
		} else if (type === "object") {
			setObjectPinned(isPinned("object", id));
		}
	}, [type, id]);

	function handleNamespaceToggle() {
		if (namespacePinned) {
			unpinItem("namespace", id);
			setNamespacePinned(false);
		} else {
			const success = pinItem({
				type: "namespace",
				id,
				name,
			});
			if (success) {
				setNamespacePinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
			}
		}
	}

	function handleObjectToggle() {
		if (objectPinned) {
			unpinItem("object", id);
			setObjectPinned(false);
		} else {
			const success = pinItem({
				type: "object",
				id,
				name,
				namespaceId,
				namespaceName,
				classId,
				className,
			});
			if (success) {
				setObjectPinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
			}
		}
	}

	function handleToggleView() {
		if (viewPinned) {
			unpinItem("class", id, "view");
			setViewPinned(false);
		} else {
			const success = pinItem({
				type: "class",
				id,
				name,
				namespaceId,
				namespaceName,
				action: "view",
			});
			if (success) {
				setViewPinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
			}
		}
		setMenuOpen(false);
	}

	function handleToggleCreate() {
		if (createPinned) {
			unpinItem("class", id, "create");
			setCreatePinned(false);
		} else {
			const success = pinItem({
				type: "class",
				id,
				name,
				namespaceId,
				namespaceName,
				action: "create",
			});
			if (success) {
				setCreatePinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
			}
		}
		setMenuOpen(false);
	}

	if (type === "namespace") {
		return (
			<button
				type="button"
				className="pin-button-inline"
				onClick={handleNamespaceToggle}
				aria-label={namespacePinned ? "Unpin this namespace" : "Pin this namespace"}
				title={namespacePinned ? "Unpin namespace" : "Pin namespace"}
			>
				<IconPin filled={namespacePinned} />
			</button>
		);
	}

	if (type === "object") {
		return (
			<button
				type="button"
				className="pin-button-inline"
				onClick={handleObjectToggle}
				aria-label={objectPinned ? "Unpin this object" : "Pin this object"}
				title={objectPinned ? "Unpin object" : "Pin object"}
			>
				<IconPin filled={objectPinned} />
			</button>
		);
	}

	// type === "class"
	const anyPinned = viewPinned || createPinned;

	return (
		<div className="pin-button-wrapper">
			<button
				type="button"
				className="pin-button-inline"
				onClick={() => setMenuOpen((current) => !current)}
				aria-label={anyPinned ? "Manage class pins" : "Pin this class"}
				aria-haspopup="menu"
				aria-expanded={isMenuOpen}
				title={anyPinned ? "Manage pins" : "Pin class"}
			>
				<IconPin filled={anyPinned} />
			</button>
			<PinMenu
				isOpen={isMenuOpen}
				onClose={() => setMenuOpen(false)}
				className={name}
				viewPinned={viewPinned}
				createPinned={createPinned}
				onToggleView={handleToggleView}
				onToggleCreate={handleToggleCreate}
			/>
		</div>
	);
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit pin button component**

```bash
git add src/components/pin-button.tsx
git commit -m "feat: add PinButton component with entity-specific behavior

Generic inline pin button adapting to namespace/class/object types.
Classes show menu, others toggle directly.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Update Quick Access Panel

**Files:**
- Modify: `src/components/quick-access-panel.tsx`

- [ ] **Step 1: Update imports and state**

Replace imports:
```typescript
// Old:
import { getPinnedClasses, unpinClass } from "@/lib/pinned-classes";

// New:
import { getPinnedItems, unpinItem } from "@/lib/pinned-items";
```

Replace state:
```typescript
// Old:
const [pinnedClasses, setPinnedClasses] = useState<PinnedClass[]>([]);

// New:
const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
```

Update useEffect:
```typescript
useEffect(() => {
	setRecentItems(getRecentItems().slice(0, 10));
	setPinnedItems(getPinnedItems());
}, []);
```

- [ ] **Step 2: Add helper functions for pin rendering**

```typescript
function getPinItemIcon(type: PinnedItemType) {
	switch (type) {
		case "namespace":
			return <IconNamespace />;
		case "class":
			return <IconClass />;
		case "object":
			return <IconObject />;
	}
}

function getPinItemHref(item: PinnedItem): string {
	switch (item.type) {
		case "namespace":
			return `/namespaces/${item.id}`;
		case "class":
			if (item.action === "view") {
				return `/objects?classId=${item.id}`;
			}
			return `/objects?create=1&classId=${item.id}`;
		case "object":
			return `/objects/${item.classId}/${item.id}`;
	}
}

function getPinItemTooltip(item: PinnedItem): string | undefined {
	if (item.type === "namespace") {
		return undefined;
	}
	if (item.type === "class") {
		return item.namespaceName;
	}
	return `${item.namespaceName} > ${item.className}`;
}

function getPinItemBadge(item: PinnedItem): string | undefined {
	return item.type === "class" ? item.action : undefined;
}
```

- [ ] **Step 3: Update unpin handler**

```typescript
function handleUnpin(item: PinnedItem) {
	if (item.type === "class") {
		unpinItem("class", item.id, item.action);
	} else {
		unpinItem(item.type, item.id);
	}
	setPinnedItems(getPinnedItems());
}
```

- [ ] **Step 4: Replace pinned items rendering**

Replace the pinned shortcuts section:
```typescript
<section className="stack">
	<h2 className="eyebrow">Pinned Shortcuts</h2>

	{pinnedItems.length === 0 ? (
		<div className="quick-access-empty">
			<p className="muted">No pinned items yet</p>
			<p className="muted quick-access-empty-subtext">
				Pin your favorite namespaces, classes, and objects for quick access
			</p>
		</div>
	) : (
		<ul className="pinned-shortcuts-list">
			{pinnedItems.map((item, index) => {
				const tooltip = getPinItemTooltip(item);
				const badge = getPinItemBadge(item);
				const key = item.type === "class"
					? `${item.type}-${item.id}-${item.action}`
					: `${item.type}-${item.id}`;

				return (
					<li key={key}>
						<Link
							href={getPinItemHref(item)}
							className="pinned-item-link"
							title={tooltip}
						>
							<span className="pinned-item-icon">
								{getPinItemIcon(item.type)}
							</span>
							<span className="pinned-item-content">
								<span className="pinned-item-name">
									{item.name}
									{badge ? (
										<span className="pinned-item-badge">{badge}</span>
									) : null}
								</span>
							</span>
						</Link>
						<button
							type="button"
							className="ghost icon-button pinned-item-unpin"
							onClick={() => handleUnpin(item)}
							aria-label={`Unpin ${item.name}`}
						>
							<IconClose />
						</button>
					</li>
				);
			})}
		</ul>
	)}
</section>
```

- [ ] **Step 5: Remove old handlePinnedClick function**

Delete the `handlePinnedClick` function - no longer needed since pins navigate directly via Link href

- [ ] **Step 6: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 7: Commit QuickAccessPanel updates**

```bash
git add src/components/quick-access-panel.tsx
git commit -m "feat: update QuickAccessPanel for unified pin system

Display all pin types with badges, tooltips, and direct navigation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Update Class Detail Page

**Files:**
- Modify: `src/components/class-detail.tsx`

- [ ] **Step 1: Replace imports**

```typescript
// Remove:
import { ClassDetailActions } from "@/components/class-detail-actions";

// Add:
import { PinButton } from "@/components/pin-button";
```

- [ ] **Step 2: Update header structure (around line 408-418)**

Replace:
```typescript
<div className="header-with-actions">
	<h2>
		{classData.name} (#{classData.id})
	</h2>
	<ClassDetailActions
		classId={classId}
		className={classData.name}
		namespaceName={classData.namespace.name}
		namespaceId={classData.namespace.id}
	/>
</div>
```

With:
```typescript
<h2>
	{classData.name} (#{classData.id})
	<PinButton
		type="class"
		id={classId}
		name={classData.name}
		namespaceId={classData.namespace.id}
		namespaceName={classData.namespace.name}
	/>
</h2>
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit class detail update**

```bash
git add src/components/class-detail.tsx
git commit -m "feat: replace ClassDetailActions with inline PinButton

Pin button now appears inline with class name.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Update Namespace Detail Page

**Files:**
- Modify: `src/components/namespace-detail.tsx`

- [ ] **Step 1: Add import**

```typescript
import { PinButton } from "@/components/pin-button";
```

- [ ] **Step 2: Update header structure (around line 960)**

Replace:
```typescript
<h2>
	{namespaceData.name} (#{namespaceData.id})
</h2>
```

With:
```typescript
<h2>
	{namespaceData.name} (#{namespaceData.id})
	<PinButton
		type="namespace"
		id={namespaceId}
		name={namespaceData.name}
	/>
</h2>
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit namespace detail update**

```bash
git add src/components/namespace-detail.tsx
git commit -m "feat: add inline PinButton to namespace detail

Users can now pin namespaces from detail page.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Update Object Detail Page

**Files:**
- Modify: `src/components/object-detail.tsx`

- [ ] **Step 1: Add import**

```typescript
import { PinButton } from "@/components/pin-button";
```

- [ ] **Step 2: Update header structure (around line 763)**

Replace:
```typescript
<h2>
	{objectData.name} (#{objectData.id})
</h2>
```

With:
```typescript
<h2>
	{objectData.name} (#{objectData.id})
	<PinButton
		type="object"
		id={objectId}
		name={objectData.name}
		namespaceId={objectData.namespace_id}
		namespaceName={namespaceLabel}
		classId={classId}
		className={className ?? undefined}
	/>
</h2>
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit object detail update**

```bash
git add src/components/object-detail.tsx
git commit -m "feat: add inline PinButton to object detail

Users can now pin objects from detail page.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Add CSS Styles

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add pin button styles**

```css
/* Pin Button - Inline */
.pin-button-inline {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	padding: 0;
	margin-left: 8px;
	background: none;
	border: none;
	cursor: pointer;
	opacity: 0.6;
	transition: opacity 0.2s ease;
	vertical-align: middle;
}

.pin-button-inline:hover {
	opacity: 1;
}

.pin-button-inline .pin-icon {
	width: 16px;
	height: 16px;
	display: block;
}

.pin-button-wrapper {
	display: inline-block;
	position: relative;
	vertical-align: middle;
}

/* Pin Menu - Dropdown */
.pin-menu {
	position: absolute;
	top: 100%;
	left: 0;
	margin-top: 4px;
	background: var(--color-card-bg);
	border: 1px solid var(--color-border);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-lg);
	min-width: 220px;
	z-index: 100;
	padding: 4px;
}

.pin-menu-option {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 8px 12px;
	background: none;
	border: none;
	border-radius: var(--radius-sm);
	cursor: pointer;
	text-align: left;
	font-size: var(--font-sm);
	color: var(--color-text);
	transition: background-color 0.15s ease;
}

.pin-menu-option:hover {
	background: var(--color-hover-subtle);
}

.pin-menu-option--checked {
	background: var(--color-hover-subtle);
}

.pin-menu-check {
	width: 16px;
	text-align: center;
	font-weight: bold;
	color: var(--color-primary);
}

/* Pinned Item Badge */
.pinned-item-badge {
	display: inline-block;
	margin-left: 6px;
	padding: 2px 6px;
	background: var(--color-primary-subtle);
	color: var(--color-primary);
	border-radius: var(--radius-sm);
	font-size: 11px;
	font-weight: 500;
	text-transform: lowercase;
	vertical-align: middle;
}

/* Adjust h2 to accommodate inline button */
h2 {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0;
}
```

- [ ] **Step 2: Verify styles render correctly**

Run: `npm run dev`
Test in browser:
1. Navigate to class detail - pin button should appear inline after class name
2. Click pin - menu should appear below button
3. Select action - badge should appear in Quick Access Panel
4. Test namespace and object pins

- [ ] **Step 3: Commit CSS updates**

```bash
git add src/app/globals.css
git commit -m "feat: add styles for inline pin button and menu

16px pin icon, dropdown menu, and action badges.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Testing and Cleanup

**Files:**
- Modify: `src/lib/pinned-classes.ts` (delete)
- Modify: `src/components/class-detail-actions.tsx` (delete)

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No errors (fix any issues found)

- [ ] **Step 3: Manual testing checklist**

Test in browser (`npm run dev`):
- [ ] Visit landing page `/app` - Quick Access Panel visible
- [ ] Navigate to namespace detail - pin button inline with name
- [ ] Click namespace pin - toggles, appears in Quick Access Panel
- [ ] Navigate to class detail - pin button inline with name
- [ ] Click class pin - menu appears with 2 options
- [ ] Select "View objects" - pin added with "view" badge
- [ ] Select "Create object" - second pin added with "create" badge
- [ ] Navigate to object detail - pin button inline with name
- [ ] Click object pin - toggles, appears in Quick Access Panel
- [ ] Verify 10-pin limit - try adding 11th pin, alert shown
- [ ] Test pin navigation - click each pin type, correct pages load
- [ ] Test tooltips - hover class pin (namespace), object pin (namespace > class)
- [ ] Unpin items - X buttons work for all types
- [ ] Test responsive - resize to mobile, pins stack properly
- [ ] Clear localStorage, reload - verify empty state messaging

- [ ] **Step 4: Test migration**

1. Clear localStorage: `localStorage.clear()`
2. Add old format: `localStorage.setItem('hubuum.pinned-classes', JSON.stringify([{classId:1,className:"Server",namespaceName:"Infrastructure"}]))`
3. Reload page
4. Verify pin appears with "create" badge
5. Verify old key deleted: `localStorage.getItem('hubuum.pinned-classes')` returns null

- [ ] **Step 5: Delete old files**

```bash
rm src/lib/pinned-classes.ts
rm src/components/class-detail-actions.tsx
git add -A
git commit -m "refactor: remove old pinned classes utilities and component

Replaced by unified pinned items system.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 6: Final verification**

Run: `npm run typecheck && npm run lint`
Expected: Both pass with no errors

---

## Success Criteria

✅ Pin button appears inline (16×16px) with entity names
✅ Namespace and object pins toggle directly
✅ Class pins show menu with view/create options
✅ Same class can be pinned twice (different actions)
✅ Quick Access Panel shows unified list (max 10)
✅ Entity names only shown; tooltips provide context
✅ Class pins show "view" or "create" badge
✅ Old pinned classes migrate automatically
✅ All navigation works as specified
✅ TypeScript compilation passes
✅ Linter passes
