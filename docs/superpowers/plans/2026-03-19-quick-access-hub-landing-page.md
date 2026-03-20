# Quick Access Hub Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the landing page from a static action-card grid into a Quick Access Hub with recent items, pinned shortcuts, and enhanced action cards.

**Architecture:** Two-column layout (40/60 split on desktop, stacked on mobile). Left column shows recent history and pinned classes from localStorage. Right column shows enhanced action cards with icons and counts. No backend changes required.

**Tech Stack:** React Server Components, Next.js 16 App Router, TypeScript, localStorage for persistence

---

## File Structure

### New Files
- `src/types/quick-access.ts` - TypeScript type definitions
- `src/lib/recent-items.ts` - localStorage utilities for recent items tracking
- `src/lib/pinned-classes.ts` - localStorage utilities for pinned classes management
- `src/components/quick-access-panel.tsx` - Quick Access Panel client component
- `src/components/namespace-detail-tracker.tsx` - Client component to track namespace visits
- `src/components/class-detail-actions.tsx` - Client component for class pin/unpin + tracking
- `src/components/object-detail-tracker.tsx` - Client component to track object visits

### Modified Files
- `src/app/(protected)/app/page.tsx` - Landing page component (major redesign - full replacement)
- `src/app/globals.css` - Add styles for new layout and components
- `src/components/namespace-detail.tsx` - Integrate recent visit tracking
- `src/components/class-detail.tsx` - Integrate tracking + pin/unpin UI
- `src/components/object-detail.tsx` - Integrate recent visit tracking

---

## Task 1: Type Definitions

**Files:**
- Create: `src/types/quick-access.ts`

- [ ] **Step 1: Create type definitions file**

```typescript
export type RecentItemType = "namespace" | "class" | "object";

export interface RecentItem {
	type: RecentItemType;
	id: number;
	name: string;
	timestamp: number;
	classId?: number;
	namespaceId?: number;
}

export interface PinnedClass {
	classId: number;
	className: string;
	namespaceName: string;
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/quick-access.ts
git commit -m "feat: add Quick Access Hub type definitions

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Recent Items Utilities

**Files:**
- Create: `src/lib/recent-items.ts`

- [ ] **Step 1: Create recent items utility module**

```typescript
import type { RecentItem } from "@/types/quick-access";

const RECENT_ITEMS_KEY = "hubuum.recent-items";
const MAX_RECENT_ITEMS = 50;

export function getRecentItems(): RecentItem[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(RECENT_ITEMS_KEY);
		if (!stored) {
			return [];
		}

		const items = JSON.parse(stored) as RecentItem[];
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
}

export function trackRecentItem(item: Omit<RecentItem, "timestamp">): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const existing = getRecentItems();
		const filtered = existing.filter(
			(i) => !(i.type === item.type && i.id === item.id),
		);

		const updated: RecentItem[] = [
			{ ...item, timestamp: Date.now() },
			...filtered,
		].slice(0, MAX_RECENT_ITEMS);

		window.localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated));
	} catch {
		// Silently fail if localStorage is unavailable
	}
}

export function clearRecentItems(): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.removeItem(RECENT_ITEMS_KEY);
	} catch {
		// Silently fail
	}
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/recent-items.ts
git commit -m "feat: add recent items localStorage utilities

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Pinned Classes Utilities

**Files:**
- Create: `src/lib/pinned-classes.ts`

- [ ] **Step 1: Create pinned classes utility module**

```typescript
import type { PinnedClass } from "@/types/quick-access";

const PINNED_CLASSES_KEY = "hubuum.pinned-classes";
const MAX_PINNED_CLASSES = 5;

export function getPinnedClasses(): PinnedClass[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(PINNED_CLASSES_KEY);
		if (!stored) {
			return [];
		}

		const items = JSON.parse(stored) as PinnedClass[];
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
}

export function pinClass(
	classId: number,
	className: string,
	namespaceName: string,
): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	try {
		const existing = getPinnedClasses();

		if (existing.some((item) => item.classId === classId)) {
			return false;
		}

		if (existing.length >= MAX_PINNED_CLASSES) {
			return false;
		}

		const updated: PinnedClass[] = [
			...existing,
			{ classId, className, namespaceName },
		];

		window.localStorage.setItem(PINNED_CLASSES_KEY, JSON.stringify(updated));
		return true;
	} catch {
		return false;
	}
}

export function unpinClass(classId: number): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const existing = getPinnedClasses();
		const filtered = existing.filter((item) => item.classId !== classId);

		window.localStorage.setItem(PINNED_CLASSES_KEY, JSON.stringify(filtered));
	} catch {
		// Silently fail
	}
}

export function isPinned(classId: number): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const pinned = getPinnedClasses();
	return pinned.some((item) => item.classId === classId);
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/pinned-classes.ts
git commit -m "feat: add pinned classes localStorage utilities

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Quick Access Panel Component (Client)

**Files:**
- Create: `src/components/quick-access-panel.tsx`

> **Note:** The pinned class click handler navigates to `/objects?create=1&classId=${classId}`. This assumes the existing create object modal responds to this URL pattern. If this pattern doesn't work, adjust the navigation in `handlePinnedClick` to match the actual create flow.

- [ ] **Step 1: Create Quick Access Panel client component**

```typescript
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PinnedClass, RecentItem } from "@/types/quick-access";
import {
	clearRecentItems,
	getRecentItems,
} from "@/lib/recent-items";
import { getPinnedClasses, unpinClass } from "@/lib/pinned-classes";

function IconNamespace() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10 4 8 6H4a2 2 0 0 0-2 2v1h20V8a2 2 0 0 0-2-2h-8l-2-2Zm12 7H2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconClass() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3 3 7.5 12 12l9-4.5zm-9 7.7V17l9 4.5V15zm18 0L12 15v6.5L21 17z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconObject() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M3 7 12 2l9 5v10l-9 5-9-5zm9-3.3L6 7l6 3.3L18 7zm-7 5v7l6 3.3v-7z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconClose() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"
				fill="currentColor"
			/>
		</svg>
	);
}

function getItemIcon(type: RecentItem["type"]) {
	switch (type) {
		case "namespace":
			return <IconNamespace />;
		case "class":
			return <IconClass />;
		case "object":
			return <IconObject />;
	}
}

function getItemHref(item: RecentItem): string {
	switch (item.type) {
		case "namespace":
			return `/namespaces/${item.id}`;
		case "class":
			return `/classes/${item.id}`;
		case "object":
			return `/objects/${item.classId}/${item.id}`;
	}
}

function formatTimestamp(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) {
		return "Just now";
	}
	if (minutes < 60) {
		return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	}
	if (hours < 24) {
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function QuickAccessPanel() {
	const router = useRouter();
	const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
	const [pinnedClasses, setPinnedClasses] = useState<PinnedClass[]>([]);

	useEffect(() => {
		setRecentItems(getRecentItems().slice(0, 10));
		setPinnedClasses(getPinnedClasses());
	}, []);

	function handleClearRecent() {
		if (
			window.confirm(
				"Clear all recent items? This action cannot be undone.",
			)
		) {
			clearRecentItems();
			setRecentItems([]);
		}
	}

	function handleUnpin(classId: number) {
		unpinClass(classId);
		setPinnedClasses(getPinnedClasses());
	}

	function handlePinnedClick(classId: number) {
		router.push(`/objects?create=1&classId=${classId}`);
	}

	return (
		<div className="quick-access-panel card stack">
			<section className="stack">
				<div className="quick-access-header">
					<h2 className="eyebrow">Recent Items</h2>
					{recentItems.length > 0 ? (
						<button
							type="button"
							className="ghost quick-access-clear"
							onClick={handleClearRecent}
						>
							Clear
						</button>
					) : null}
				</div>

				{recentItems.length === 0 ? (
					<div className="quick-access-empty">
						<p className="muted">No recent items yet</p>
						<p className="muted quick-access-empty-subtext">
							Items you view will appear here for quick access
						</p>
					</div>
				) : (
					<ul className="recent-items-list">
						{recentItems.map((item) => (
							<li key={`${item.type}-${item.id}`}>
								<Link
									href={getItemHref(item)}
									className="recent-item-link"
								>
									<span className="recent-item-icon">
										{getItemIcon(item.type)}
									</span>
									<span className="recent-item-content">
										<span className="recent-item-name">{item.name}</span>
										<span className="recent-item-meta">
											{item.type.charAt(0).toUpperCase() + item.type.slice(1)}{" "}
											• {formatTimestamp(item.timestamp)}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="stack">
				<h2 className="eyebrow">Pinned Shortcuts</h2>

				{pinnedClasses.length === 0 ? (
					<div className="quick-access-empty">
						<p className="muted">No pinned classes yet</p>
						<p className="muted quick-access-empty-subtext">
							Pin your favorite classes for quick object creation
						</p>
					</div>
				) : (
					<ul className="pinned-shortcuts-list">
						{pinnedClasses.map((item) => (
							<li key={item.classId}>
								<button
									type="button"
									className="pinned-item-link"
									onClick={() => handlePinnedClick(item.classId)}
								>
									<span className="pinned-item-icon">
										<IconClass />
									</span>
									<span className="pinned-item-content">
										<span className="pinned-item-name">
											{item.className}
										</span>
										<span className="pinned-item-meta">
											{item.namespaceName}
										</span>
									</span>
								</button>
								<button
									type="button"
									className="ghost icon-button pinned-item-unpin"
									onClick={() => handleUnpin(item.classId)}
									aria-label={`Unpin ${item.className}`}
								>
									<IconClose />
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/quick-access-panel.tsx
git commit -m "feat: add Quick Access Panel component

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Redesign Landing Page Layout

**Files:**
- Modify: `src/app/(protected)/app/page.tsx`

> **Note:** The replacement code assumes these imports/functions exist: `hasAdminAccess`, `requireServerSession`, `fetchMetaCounts`, `getTotalNamespaces`. Step 1 will verify these are available in the current file.

- [ ] **Step 1: Read current landing page and verify dependencies**

Run: `Read src/app/(protected)/app/page.tsx`

Verify these imports/functions exist:
- `hasAdminAccess` from `@/lib/auth/admin`
- `requireServerSession` from `@/lib/auth/guards`
- `fetchMetaCounts`, `getTotalNamespaces` from `@/lib/meta`
- `CORRELATION_ID_HEADER`, `normalizeCorrelationId` from `@/lib/correlation`

- [ ] **Step 2: Refactor to two-column layout**

Update `src/app/(protected)/app/page.tsx`:

```typescript
import { headers } from "next/headers";
import Link from "next/link";

import { QuickAccessPanel } from "@/components/quick-access-panel";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { fetchMetaCounts, getTotalNamespaces } from "@/lib/meta";

type ActionCard = {
	title: string;
	description: string;
	icon: React.ReactNode;
	count?: string;
	primaryHref: string;
	primaryLabel: string;
	secondaryHref?: string;
	secondaryLabel?: string;
};

type RecommendedAction = {
	title: string;
	description: string;
	icon: React.ReactNode;
	primaryHref: string;
	primaryLabel: string;
	secondaryHref: string;
	secondaryLabel: string;
};

function IconNamespace() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10 4 8 6H4a2 2 0 0 0-2 2v1h20V8a2 2 0 0 0-2-2h-8l-2-2Zm12 7H2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconClass() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3 3 7.5 12 12l9-4.5zm-9 7.7V17l9 4.5V15zm18 0L12 15v6.5L21 17z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconObject() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M3 7 12 2l9 5v10l-9 5-9-5zm9-3.3L6 7l6 3.3L18 7zm-7 5v7l6 3.3v-7z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconRelation() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M7 4a3 3 0 1 0 2.83 4H14v3.17A3 3 0 1 0 16 14h-4v-2h2.17A3 3 0 1 0 14 10h-4.17A3 3 0 0 0 7 4Z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconReport() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M6 3h8.8L20 8.2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m8 1.8V9h4.2M8 12h8v1.8H8zm0 4h8v1.8H8z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconImport() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3 6.7 8.3l1.3 1.4 3.1-3.1V16h2V6.6l3.1 3.1 1.4-1.4ZM5 18h14v3H5z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconOverview() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M4 13h7V4H4zm0 7h7v-5H4zm9 0h7V11h-7zm0-18v7h7V2z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconUser() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12m0 2.2c-4 0-7.5 2.1-7.5 4.8V21h15v-2c0-2.7-3.5-4.8-7.5-4.8"
				fill="currentColor"
			/>
		</svg>
	);
}

function getRecommendedAction(
	totalNamespaces: number,
	totalClasses: number,
	totalObjects: number,
): RecommendedAction {
	if (totalNamespaces === 0) {
		return {
			title: "Start by creating a namespace",
			description:
				"Namespaces are the entry point for permissions, classes, and everything else in the workspace.",
			icon: <IconNamespace />,
			primaryHref: "/namespaces?create=1",
			primaryLabel: "Create namespace",
			secondaryHref: "/namespaces",
			secondaryLabel: "Open namespaces",
		};
	}

	if (totalClasses === 0) {
		return {
			title: "Define your first class",
			description:
				"Once a namespace exists, classes give your objects a schema and a place to live.",
			icon: <IconClass />,
			primaryHref: "/classes?create=1",
			primaryLabel: "Create class",
			secondaryHref: "/classes",
			secondaryLabel: "Open classes",
		};
	}

	if (totalObjects === 0) {
		return {
			title: "Add your first object",
			description:
				"You have structure in place. The next useful step is adding real records to a class.",
			icon: <IconObject />,
			primaryHref: "/objects?create=1",
			primaryLabel: "Create object",
			secondaryHref: "/objects",
			secondaryLabel: "Open objects",
		};
	}

	return {
		title: "Continue with objects",
		description:
			"Most day-to-day work happens around browsing, updating, and extending existing objects.",
		icon: <IconObject />,
		primaryHref: "/objects",
		primaryLabel: "Open objects",
		secondaryHref: "/relations/classes?create=1",
		secondaryLabel: "Create relation",
	};
}

function getActionCards(
	totalNamespaces: number,
	totalClasses: number,
	totalObjects: number,
	canViewAdmin: boolean,
): ActionCard[] {
	const cards: ActionCard[] = [
		{
			title: "Set up namespaces",
			icon: <IconNamespace />,
			count:
				totalNamespaces > 0
					? `${totalNamespaces} namespace${totalNamespaces === 1 ? "" : "s"}`
					: undefined,
			description:
				totalNamespaces === 0
					? "No namespaces exist yet. Start here to establish ownership and permissions."
					: `${totalNamespaces} namespace${totalNamespaces === 1 ? "" : "s"} available for organizing classes and access.`,
			primaryHref: "/namespaces?create=1",
			primaryLabel: "Create namespace",
			secondaryHref: "/namespaces",
			secondaryLabel: "Browse namespaces",
		},
		{
			title: "Define classes",
			icon: <IconClass />,
			count:
				totalClasses > 0
					? `${totalClasses} class${totalClasses === 1 ? "" : "es"}`
					: undefined,
			description:
				totalNamespaces === 0
					? "Classes depend on namespaces, so create a namespace first."
					: totalClasses === 0
						? "No classes yet. Define one to describe the objects your team will manage."
						: `${totalClasses} class${totalClasses === 1 ? "" : "es"} defined across the workspace.`,
			primaryHref: "/classes?create=1",
			primaryLabel: "Create class",
			secondaryHref: "/classes",
			secondaryLabel: "Browse classes",
		},
		{
			title: "Work with objects",
			icon: <IconObject />,
			count:
				totalObjects > 0
					? `${totalObjects} object${totalObjects === 1 ? "" : "s"}`
					: undefined,
			description:
				totalClasses === 0
					? "Objects depend on classes. Once a class exists, this becomes the main operational area."
					: totalObjects === 0
						? "No objects yet. Add the first object to start using the model."
						: `${totalObjects} object${totalObjects === 1 ? "" : "s"} currently available to inspect and update.`,
			primaryHref: "/objects?create=1",
			primaryLabel: "Create object",
			secondaryHref: "/objects",
			secondaryLabel: "Open objects",
		},
		{
			title: "Connect relations",
			icon: <IconRelation />,
			description:
				totalClasses < 2
					? "Relations become useful once you have at least two classes or established object records."
					: "Map how classes and objects relate so navigation and reachability become meaningful.",
			primaryHref: "/relations/classes?create=1",
			primaryLabel: "Create relation",
			secondaryHref: "/relations/classes",
			secondaryLabel: "Open relations",
		},
		{
			title: "Build reports",
			icon: <IconReport />,
			description:
				totalClasses === 0
					? "Reports become useful once you have real collections to query, but you can prepare templates ahead of time."
					: "Create stored templates and run scoped reports without leaving the workspace.",
			primaryHref: "/reports",
			primaryLabel: "Open reports",
		},
		{
			title: "Run imports",
			icon: <IconImport />,
			description:
				"Submit JSON import jobs, then monitor queue state, lifecycle events, and per-item outcomes.",
			primaryHref: "/imports",
			primaryLabel: "Open imports",
		},
		{
			title: "Inspect system statistics",
			icon: <IconOverview />,
			description:
				"Counts and database health still matter, but they no longer need to dominate the landing experience.",
			primaryHref: "/statistics",
			primaryLabel: "Open statistics",
		},
	];

	if (canViewAdmin) {
		cards.push({
			title: "Manage access",
			icon: <IconUser />,
			description:
				"Review users and groups when you need to inspect permissions or prepare access changes.",
			primaryHref: "/admin",
			primaryLabel: "Open admin",
			secondaryHref: "/admin/users",
			secondaryLabel: "Users",
		});
	}

	return cards;
}

export default async function AppPage() {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await requireServerSession();
	const [counts, canViewAdmin] = await Promise.all([
		fetchMetaCounts(session.token, correlationId),
		hasAdminAccess(session.token, correlationId),
	]);
	const totalNamespaces = getTotalNamespaces(counts);
	const recommendedAction = getRecommendedAction(
		totalNamespaces,
		counts.total_classes,
		counts.total_objects,
	);
	const actionCards = getActionCards(
		totalNamespaces,
		counts.total_classes,
		counts.total_objects,
		canViewAdmin,
	);

	return (
		<div className="landing-page-layout">
			<QuickAccessPanel />

			<section className="all-actions-panel stack">
				<article className="card stack home-priority-card">
					<div className="action-card-icon-container">
						{recommendedAction.icon}
					</div>
					<div className="stack action-card-header">
						<p className="eyebrow">Recommended next step</p>
						<h3>{recommendedAction.title}</h3>
						<p className="muted">{recommendedAction.description}</p>
					</div>

					<div className="action-card-actions">
						<Link className="link-chip" href={recommendedAction.primaryHref}>
							{recommendedAction.primaryLabel}
						</Link>
						<Link className="link-chip" href={recommendedAction.secondaryHref}>
							{recommendedAction.secondaryLabel}
						</Link>
					</div>
				</article>

				<div className="grid cols-2">
					{actionCards.map((card) => (
						<article key={card.title} className="card stack action-card">
							<div className="action-card-icon-container">
								{card.icon}
							</div>
							<div className="stack action-card-header">
								<div className="action-card-title-row">
									<h3>{card.title}</h3>
									{card.count ? (
										<span className="action-card-count">{card.count}</span>
									) : null}
								</div>
								<p className="muted">{card.description}</p>
							</div>

							<div className="action-card-actions">
								<Link className="link-chip" href={card.primaryHref}>
									{card.primaryLabel}
								</Link>
								{card.secondaryHref && card.secondaryLabel ? (
									<Link className="link-chip" href={card.secondaryHref}>
										{card.secondaryLabel}
									</Link>
								) : null}
							</div>
						</article>
					))}
				</div>
			</section>
		</div>
	);
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/(protected)/app/page.tsx
git commit -m "feat: redesign landing page with two-column layout

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add CSS Styles for Quick Access Hub

**Files:**
- Modify: `src/app/globals.css`

> **Note:** The CSS below uses existing CSS variables: `--bg-highlight`, `--accent-soft`, `--bg`, `--card`, `--muted`, `--accent`, `--line`. Step 1 will verify these variables exist.

- [ ] **Step 1: Read current globals.css file and verify CSS variables**

Run: `Read src/app/globals.css`

Verify these CSS variables are defined in `:root` or `html[data-theme]`:
- `--bg-highlight`, `--accent-soft`, `--bg`, `--card`, `--muted`, `--accent`, `--line`

- [ ] **Step 2: Add Quick Access Hub styles at end of file**

Append to `src/app/globals.css`:

```css
/* Landing page layout */
.landing-page-layout {
	display: grid;
	gap: 1.5rem;
	grid-template-columns: 40% 60%;
}

@media (max-width: 768px) {
	.landing-page-layout {
		grid-template-columns: 1fr;
	}
}

/* Quick Access Panel */
.quick-access-panel {
	padding: 1.2rem;
}

.quick-access-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}

.quick-access-clear {
	padding: 0.4rem 0.7rem;
	font-size: 0.85rem;
}

.quick-access-empty {
	padding: 1.5rem 0.5rem;
	text-align: center;
	display: grid;
	gap: 0.3rem;
}

.quick-access-empty-subtext {
	font-size: 0.85rem;
}

/* Recent Items List */
.recent-items-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: 0.3rem;
}

.recent-item-link {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	padding: 0.6rem 0.7rem;
	border-radius: 10px;
	transition: background 0.15s;
	color: inherit;
	text-decoration: none;
}

.recent-item-link:hover {
	background: var(--bg-highlight);
}

.recent-item-icon {
	width: 18px;
	height: 18px;
	color: var(--accent);
	flex-shrink: 0;
}

.recent-item-content {
	display: grid;
	gap: 0.2rem;
	min-width: 0;
}

.recent-item-name {
	font-weight: 500;
	font-size: 0.9rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.recent-item-meta {
	font-size: 0.75rem;
	color: var(--muted);
}

/* Pinned Shortcuts List */
.pinned-shortcuts-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: 0.3rem;
}

.pinned-shortcuts-list li {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.pinned-item-link {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	padding: 0.6rem 0.7rem;
	border-radius: 10px;
	transition: background 0.15s;
	color: inherit;
	text-decoration: none;
	flex: 1;
	min-width: 0;
	background: transparent;
	border: none;
	cursor: pointer;
	text-align: left;
}

.pinned-item-link:hover {
	background: var(--bg-highlight);
}

.pinned-item-icon {
	width: 18px;
	height: 18px;
	color: var(--accent);
	flex-shrink: 0;
}

.pinned-item-content {
	display: grid;
	gap: 0.2rem;
	min-width: 0;
}

.pinned-item-name {
	font-weight: 500;
	font-size: 0.9rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.pinned-item-meta {
	font-size: 0.75rem;
	color: var(--muted);
}

.pinned-item-unpin {
	padding: 0.4rem;
	opacity: 0;
	transition: opacity 0.15s;
}

.pinned-shortcuts-list li:hover .pinned-item-unpin {
	opacity: 1;
}

/* All Actions Panel */
.all-actions-panel {
	gap: 1.5rem;
}

.home-priority-card {
	padding: 1.5rem;
	background: var(--accent-soft);
	border-color: var(--accent);
}

.action-card-icon-container {
	width: 32px;
	height: 32px;
	color: var(--accent);
}

.action-card-title-row {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.action-card-count {
	font-size: 0.75rem;
	color: var(--muted);
	background: var(--bg);
	padding: 0.2rem 0.5rem;
	border-radius: 8px;
	font-weight: 600;
}

.icon-button {
	padding: 0.5rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
}
```

- [ ] **Step 3: Test responsive layout**

Run: `npm run dev`
Open: `http://localhost:3000/app`
Expected: Two-column layout on desktop, stacked on mobile

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add Quick Access Hub CSS styles

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Track Recent Items in Namespace Detail

**Files:**
- Create: `src/components/namespace-detail-tracker.tsx`
- Modify: `src/components/namespace-detail.tsx`

- [ ] **Step 1: Read current namespace detail component**

Run: `Read src/components/namespace-detail.tsx`

- [ ] **Step 2: Add client component wrapper for recent tracking**

Create `src/components/namespace-detail-tracker.tsx`:

```typescript
"use client";

import { useEffect } from "react";

import { trackRecentItem } from "@/lib/recent-items";

interface NamespaceDetailTrackerProps {
	namespaceId: number;
	namespaceName: string;
}

export function NamespaceDetailTracker({
	namespaceId,
	namespaceName,
}: NamespaceDetailTrackerProps) {
	useEffect(() => {
		trackRecentItem({
			type: "namespace",
			id: namespaceId,
			name: namespaceName,
		});
	}, [namespaceId, namespaceName]);

	return null;
}
```

- [ ] **Step 3: Integrate tracker into namespace detail component**

Update `src/components/namespace-detail.tsx`:

1. Import the tracker at the top:
```typescript
import { NamespaceDetailTracker } from "@/components/namespace-detail-tracker";
```

2. Find where the namespace data is rendered (look for a conditional render based on `namespace` or `namespaceQuery.data`).

3. Add the tracker component at the beginning of the successful data render, passing the namespace ID and name:
```typescript
<NamespaceDetailTracker
  namespaceId={namespaceId}
  namespaceName={namespace.name}
/>
```

The tracker renders nothing (returns `null`), so placement doesn't affect layout - it just needs to be inside the conditional block where `namespace` data is available.

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Test tracking**

Run: `npm run dev`
Visit a namespace detail page, then check `/app` to see it in recent items

- [ ] **Step 6: Commit**

```bash
git add src/components/namespace-detail-tracker.tsx src/components/namespace-detail.tsx
git commit -m "feat: track namespace visits in recent items

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Track Recent Items in Class Detail + Add Pin/Unpin

**Files:**
- Create: `src/components/class-detail-actions.tsx`
- Modify: `src/components/class-detail.tsx`

- [ ] **Step 1: Read current class detail component**

Run: `Read src/components/class-detail.tsx`

- [ ] **Step 2: Create class detail tracker with pin/unpin**

Create `src/components/class-detail-actions.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";

import { trackRecentItem } from "@/lib/recent-items";
import { getPinnedClasses, isPinned, pinClass, unpinClass } from "@/lib/pinned-classes";

interface ClassDetailActionsProps {
	classId: number;
	className: string;
	namespaceName: string;
	namespaceId: number;
}

function IconPin() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function ClassDetailActions({
	classId,
	className,
	namespaceName,
	namespaceId,
}: ClassDetailActionsProps) {
	const [pinned, setPinned] = useState(false);

	useEffect(() => {
		trackRecentItem({
			type: "class",
			id: classId,
			name: className,
			namespaceId,
		});

		setPinned(isPinned(classId));
	}, [classId, className, namespaceId]);

	function handleTogglePin() {
		if (pinned) {
			unpinClass(classId);
			setPinned(false);
		} else {
			const success = pinClass(classId, className, namespaceName);
			if (success) {
				setPinned(true);
			} else {
				alert("Maximum 5 classes can be pinned. Unpin one to add another.");
			}
		}
	}

	return (
		<button
			type="button"
			className={pinned ? "ghost" : ""}
			onClick={handleTogglePin}
			aria-label={pinned ? "Unpin this class" : "Pin this class"}
		>
			<IconPin />
			{pinned ? "Unpin" : "Pin class"}
		</button>
	);
}
```

- [ ] **Step 3: Integrate into class detail component**

Update `src/components/class-detail.tsx`:

1. Import the actions component at the top:
```typescript
import { ClassDetailActions } from "@/components/class-detail-actions";
```

2. Find where the class data is rendered (look for a conditional render based on `hubuumClass` or `classQuery.data`).

3. Add the actions button in the header/title section of the class detail view:
```typescript
<ClassDetailActions
  classId={classId}
  className={hubuumClass.name}
  namespaceName={hubuumClass.namespace_name}
  namespaceId={hubuumClass.namespace_id}
/>
```

Place it where other action buttons would go (likely near the class title or in a header toolbar). The component includes both tracking (via useEffect) and the pin/unpin button UI.

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Test pin/unpin functionality**

Run: `npm run dev`
Visit a class detail page, pin it, check landing page for pinned item

- [ ] **Step 6: Commit**

```bash
git add src/components/class-detail-actions.tsx src/components/class-detail.tsx
git commit -m "feat: track class visits and add pin/unpin functionality

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Track Recent Items in Object Detail

**Files:**
- Create: `src/components/object-detail-tracker.tsx`
- Modify: `src/components/object-detail.tsx`

- [ ] **Step 1: Read current object detail component**

Run: `Read src/components/object-detail.tsx`

- [ ] **Step 2: Create object detail tracker**

Create `src/components/object-detail-tracker.tsx`:

```typescript
"use client";

import { useEffect } from "react";

import { trackRecentItem } from "@/lib/recent-items";

interface ObjectDetailTrackerProps {
	objectId: number;
	objectName: string;
	classId: number;
	namespaceId: number;
}

export function ObjectDetailTracker({
	objectId,
	objectName,
	classId,
	namespaceId,
}: ObjectDetailTrackerProps) {
	useEffect(() => {
		trackRecentItem({
			type: "object",
			id: objectId,
			name: objectName,
			classId,
			namespaceId,
		});
	}, [objectId, objectName, classId, namespaceId]);

	return null;
}
```

- [ ] **Step 3: Integrate tracker into object detail component**

Update `src/components/object-detail.tsx`:

1. Import the tracker at the top:
```typescript
import { ObjectDetailTracker } from "@/components/object-detail-tracker";
```

2. Find where the object data is rendered (look for a conditional render based on `object` or `objectQuery.data`).

3. Add the tracker component at the beginning of the successful data render:
```typescript
<ObjectDetailTracker
  objectId={objectId}
  objectName={object.name}
  classId={classId}
  namespaceId={object.namespace_id}
/>
```

The tracker renders nothing (returns `null`), so placement doesn't affect layout - it just needs to be inside the conditional block where `object` data is available.

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Test tracking**

Run: `npm run dev`
Visit an object detail page, check landing page for recent item

- [ ] **Step 6: Commit**

```bash
git add src/components/object-detail-tracker.tsx src/components/object-detail.tsx
git commit -m "feat: track object visits in recent items

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Final Testing and Polish

**Files:**
- All modified files

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No errors or auto-fix warnings

- [ ] **Step 3: Test all workflows**

Manual testing checklist:
- Visit landing page - see empty states
- Visit namespace/class/object detail pages
- Return to landing page - see recent items
- Pin a class from class detail page
- Return to landing page - see pinned class
- Click pinned class - opens create object modal
- Unpin class from landing page
- Clear recent items
- Test responsive layout on mobile viewport

- [ ] **Step 4: Verify accessibility**

- Tab through recent items list
- Tab through pinned shortcuts
- Screen reader announces item types
- All buttons have aria-labels

- [ ] **Step 5: Final commit if any polish needed**

```bash
git add -A
git commit -m "polish: final Quick Access Hub refinements

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Success Criteria

- [ ] Landing page loads with two-column layout on desktop
- [ ] Recent items appear after viewing namespaces/classes/objects
- [ ] Pin/unpin functionality works from class detail pages
- [ ] Pinned classes open create object flow when clicked
- [ ] Clear recent items works with confirmation
- [ ] Empty states show helpful messages
- [ ] Responsive design works on mobile
- [ ] No TypeScript errors
- [ ] No accessibility regressions
- [ ] localStorage persists across page reloads
