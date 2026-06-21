# Async Task Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the current user (toast + personal Tasks badge) when their own async tasks reach a terminal state, with `/tasks` scoped to their tasks as the catch-up inbox.

**Architecture:** A pure logic module derives transitions/unread from the existing shell poll (now fetching *my* tasks via `submitted_by` + a mandatory client-side `filterMine`); the shell fires clickable toasts and drives the badge; `lastSeenAt` lives in a per-user `localStorage` key and is reset on visiting `/tasks`. Vitest is introduced for the pure logic. Data model is "derive from the poll + a last-seen timestamp" — no parallel store, no backend change.

**Tech Stack:** Next.js 16 / React 19, `@tanstack/react-query`, plain CSS, Biome (lint), `tsc` (typecheck), **Vitest** (new, for unit tests). Spec: `docs/superpowers/specs/2026-06-21-async-task-notifications-design.md`.

## Global Constraints

- Notifications cover **only the current user's tasks**; safety guaranteed by client-side `filterMine` (`task.submitted_by === myId`) applied to every fetched list.
- Terminal statuses come from `isTerminalTaskStatus` (`src/lib/api/tasking.ts`): `succeeded`, `failed`, `partially_succeeded`, `cancelled`.
- Always pass `submittedBy: myId` to `fetchTasks` AND filter client-side.
- `lastSeenAt` key is **per user**: `hubuum.tasks.lastSeenAt.<myId>` (ms epoch as string).
- Toast vocabulary: `<Kind> #<id> <status phrase>` (+ ` — <summary>` when present); types: succeeded→success, failed→error, partially_succeeded/cancelled→info.
- Badge: `unreadCount > 0` → label `isSaturated ? "N+" : "N"`, tone `danger` if `hasUnreadFailure` else `accent`; else `activeCount > 0` → `activeCount` accent; else none. `isSaturated = pageFull` (`page.tasks.length === 50`).
- Unread comparison uses effective completion time `finished_at ?? started_at ?? created_at` strictly after `lastSeenAt`.
- Id resolution: paginate `getApiV1IamUsers({ limit: 250 })` following `x-next-cursor` until username matches; null → feature disabled.
- Indentation is **TABS** (Biome). Commit after each task.

---

### Task 1: Vitest + pure notification logic (`task-notifications.ts`)

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/task-notifications.ts`
- Create: `src/lib/task-notifications.test.ts`
- Modify: `package.json` (add `vitest` devDependency + `test` script)
- Modify: `.github/workflows/ci.yml` (run tests in CI)

**Interfaces:**
- Consumes: `TaskRecord`, `isTerminalTaskStatus` from `src/lib/api/tasking.ts`.
- Produces:
  - `filterMine<T extends { submitted_by?: number | null }>(tasks, myId: number): T[]`
  - `diffNewlyTerminal(prev: readonly TaskRecord[] | null, next: readonly TaskRecord[]): TaskRecord[]`
  - `countUnread(myTasks: readonly TaskRecord[], lastSeenAt: number, pageFull: boolean): { unreadCount: number; hasUnreadFailure: boolean; isSaturated: boolean }`
  - `toastForTransition(task: TaskRecord): { message: string; type: "success" | "error" | "info" }`
  - exported type `ToastType = "success" | "error" | "info"`

- [ ] **Step 1: Add Vitest dependency and test script**

Run: `npm install -D vitest@^3`

Then edit `package.json` `scripts` to add a `test` entry (place it after `"start"`):

```json
		"start": "node scripts/start-standalone.mjs",
		"test": "vitest run",
		"lint": "biome lint .",
```

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
```

- [ ] **Step 3: Write the failing test file**

Create `src/lib/task-notifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { TaskRecord } from "@/lib/api/tasking";
import {
	countUnread,
	diffNewlyTerminal,
	filterMine,
	toastForTransition,
} from "@/lib/task-notifications";

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
	return {
		id: 1,
		kind: "import",
		status: "running",
		created_at: "2026-06-21T10:00:00.000Z",
		links: {} as TaskRecord["links"],
		progress: {} as TaskRecord["progress"],
		...overrides,
	} as TaskRecord;
}

const seen = Date.parse("2026-06-21T12:00:00.000Z");

describe("filterMine", () => {
	it("keeps only tasks submitted by me", () => {
		const tasks = [
			makeTask({ id: 1, submitted_by: 7 }),
			makeTask({ id: 2, submitted_by: 99 }),
			makeTask({ id: 3, submitted_by: 7 }),
		];
		expect(filterMine(tasks, 7).map((t) => t.id)).toEqual([1, 3]);
	});
});

describe("diffNewlyTerminal", () => {
	it("returns [] on the first poll (prev null)", () => {
		const next = [makeTask({ id: 1, status: "succeeded" })];
		expect(diffNewlyTerminal(null, next)).toEqual([]);
	});

	it("detects non-terminal -> terminal", () => {
		const prev = [makeTask({ id: 1, status: "running" })];
		const next = [makeTask({ id: 1, status: "succeeded" })];
		expect(diffNewlyTerminal(prev, next).map((t) => t.id)).toEqual([1]);
	});

	it("ignores terminal -> terminal", () => {
		const prev = [makeTask({ id: 1, status: "succeeded" })];
		const next = [makeTask({ id: 1, status: "succeeded" })];
		expect(diffNewlyTerminal(prev, next)).toEqual([]);
	});

	it("ignores non-terminal -> non-terminal", () => {
		const prev = [makeTask({ id: 1, status: "queued" })];
		const next = [makeTask({ id: 1, status: "running" })];
		expect(diffNewlyTerminal(prev, next)).toEqual([]);
	});

	it("ignores tasks absent from prev (avoids backlog toasts)", () => {
		const prev = [makeTask({ id: 1, status: "running" })];
		const next = [
			makeTask({ id: 1, status: "running" }),
			makeTask({ id: 2, status: "succeeded" }),
		];
		expect(diffNewlyTerminal(prev, next)).toEqual([]);
	});
});

describe("countUnread", () => {
	it("counts terminal tasks finished strictly after lastSeenAt", () => {
		const tasks = [
			makeTask({ id: 1, status: "succeeded", finished_at: "2026-06-21T13:00:00.000Z" }),
			makeTask({ id: 2, status: "failed", finished_at: "2026-06-21T11:00:00.000Z" }),
			makeTask({ id: 3, status: "running", finished_at: null }),
		];
		const result = countUnread(tasks, seen, false);
		expect(result.unreadCount).toBe(1);
		expect(result.hasUnreadFailure).toBe(false);
	});

	it("treats the boundary as exclusive (equal to lastSeenAt is not unread)", () => {
		const tasks = [
			makeTask({ id: 1, status: "succeeded", finished_at: "2026-06-21T12:00:00.000Z" }),
		];
		expect(countUnread(tasks, seen, false).unreadCount).toBe(0);
	});

	it("flags unread failures", () => {
		const tasks = [
			makeTask({ id: 1, status: "partially_succeeded", finished_at: "2026-06-21T13:00:00.000Z" }),
		];
		const result = countUnread(tasks, seen, false);
		expect(result.unreadCount).toBe(1);
		expect(result.hasUnreadFailure).toBe(true);
	});

	it("falls back to started_at/created_at when finished_at is missing", () => {
		const tasks = [
			makeTask({ id: 1, status: "succeeded", finished_at: null, started_at: "2026-06-21T13:00:00.000Z" }),
			makeTask({ id: 2, status: "cancelled", finished_at: null, started_at: null, created_at: "2026-06-21T13:30:00.000Z" }),
		];
		expect(countUnread(tasks, seen, false).unreadCount).toBe(2);
	});

	it("sets isSaturated to pageFull regardless of contents", () => {
		expect(countUnread([], seen, true).isSaturated).toBe(true);
		expect(countUnread([], seen, false).isSaturated).toBe(false);
	});
});

describe("toastForTransition", () => {
	it("maps succeeded to a success toast", () => {
		const t = makeTask({ id: 42, kind: "import", status: "succeeded" });
		expect(toastForTransition(t)).toEqual({
			message: "Import #42 succeeded",
			type: "success",
		});
	});

	it("maps failed to an error toast", () => {
		const t = makeTask({ id: 41, kind: "report", status: "failed" });
		expect(toastForTransition(t)).toEqual({
			message: "Report #41 failed",
			type: "error",
		});
	});

	it("maps partially_succeeded to an info toast and includes summary", () => {
		const t = makeTask({ id: 9, kind: "import", status: "partially_succeeded", summary: "3 of 5 rows" });
		expect(toastForTransition(t)).toEqual({
			message: "Import #9 partially succeeded — 3 of 5 rows",
			type: "info",
		});
	});

	it("maps cancelled to an info toast", () => {
		const t = makeTask({ id: 5, kind: "export", status: "cancelled" });
		expect(toastForTransition(t)).toEqual({
			message: "Export #5 was cancelled",
			type: "info",
		});
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "@/lib/task-notifications"` (module not created yet).

- [ ] **Step 5: Implement the module**

Create `src/lib/task-notifications.ts`:

```ts
import { isTerminalTaskStatus, type TaskRecord } from "@/lib/api/tasking";

export type ToastType = "success" | "error" | "info";

export type NotificationToast = {
	message: string;
	type: ToastType;
};

export type UnreadSummary = {
	unreadCount: number;
	hasUnreadFailure: boolean;
	isSaturated: boolean;
};

export function filterMine<T extends { submitted_by?: number | null }>(
	tasks: readonly T[],
	myId: number,
): T[] {
	return tasks.filter((task) => task.submitted_by === myId);
}

export function diffNewlyTerminal(
	prev: readonly TaskRecord[] | null,
	next: readonly TaskRecord[],
): TaskRecord[] {
	if (!prev) {
		return [];
	}

	const prevById = new Map(prev.map((task) => [task.id, task]));

	return next.filter((task) => {
		if (!isTerminalTaskStatus(task.status)) {
			return false;
		}
		const previous = prevById.get(task.id);
		return previous != null && !isTerminalTaskStatus(previous.status);
	});
}

function effectiveCompletionMs(task: TaskRecord): number {
	const stamp = task.finished_at ?? task.started_at ?? task.created_at ?? null;
	return stamp ? Date.parse(stamp) : Number.NaN;
}

export function countUnread(
	myTasks: readonly TaskRecord[],
	lastSeenAt: number,
	pageFull: boolean,
): UnreadSummary {
	let unreadCount = 0;
	let hasUnreadFailure = false;

	for (const task of myTasks) {
		if (!isTerminalTaskStatus(task.status)) {
			continue;
		}
		const completionMs = effectiveCompletionMs(task);
		if (Number.isNaN(completionMs) || completionMs <= lastSeenAt) {
			continue;
		}
		unreadCount += 1;
		if (task.status === "failed" || task.status === "partially_succeeded") {
			hasUnreadFailure = true;
		}
	}

	return { unreadCount, hasUnreadFailure, isSaturated: pageFull };
}

const TASK_KIND_LABELS: Record<string, string> = {
	import: "Import",
	report: "Report",
	export: "Export",
	reindex: "Reindex",
};

function taskKindLabel(kind: string): string {
	return (
		TASK_KIND_LABELS[kind] ??
		`${(kind[0] ?? "").toUpperCase()}${kind.slice(1)}`
	);
}

const STATUS_PHRASES: Record<string, { phrase: string; type: ToastType }> = {
	succeeded: { phrase: "succeeded", type: "success" },
	failed: { phrase: "failed", type: "error" },
	partially_succeeded: { phrase: "partially succeeded", type: "info" },
	cancelled: { phrase: "was cancelled", type: "info" },
};

export function toastForTransition(task: TaskRecord): NotificationToast {
	const status = STATUS_PHRASES[task.status] ?? {
		phrase: String(task.status),
		type: "info" as ToastType,
	};
	const base = `${taskKindLabel(task.kind)} #${task.id} ${status.phrase}`;
	const message = task.summary ? `${base} — ${task.summary}` : base;
	return { message, type: status.type };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `task-notifications.test.ts` green.

- [ ] **Step 7: Add the test step to CI**

In `.github/workflows/ci.yml`, add a Test step after the Typecheck step and before Build:

```yaml
      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
```

- [ ] **Step 8: Verify static checks**

Run: `npm run lint && npm run typecheck`
Expected: both pass (no unused symbols; tabs respected).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/task-notifications.ts src/lib/task-notifications.test.ts .github/workflows/ci.yml
git commit -m "Add task-notifications logic module with Vitest coverage"
```

---

### Task 2: Toast click-through (optional action/href)

**Files:**
- Modify: `src/lib/toast-context.tsx`
- Modify: `src/components/toast-container.tsx`
- Modify: `src/app/globals.css` (add `.toast-link`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `showToast(message: string, type?: ToastType, action?: { href: string })`; toasts now carry an optional `action: { href: string }`.

- [ ] **Step 1: Extend the toast context**

In `src/lib/toast-context.tsx`, replace the `ToastType`/`Toast`/`ToastContextValue` types and the `showToast` definition. New types block (replaces the existing `type ToastType` / `type Toast` / `type ToastContextValue`):

```ts
type ToastType = "success" | "error" | "info";

type ToastAction = {
	href: string;
};

type Toast = {
	id: string;
	message: string;
	type: ToastType;
	action?: ToastAction;
};

type ToastContextValue = {
	showToast: (message: string, type?: ToastType, action?: ToastAction) => void;
	toasts: Toast[];
	removeToast: (id: string) => void;
};
```

New `showToast` (replaces the existing one):

```ts
	const showToast = useCallback(
		(message: string, type: ToastType = "info", action?: ToastAction) => {
			const id = `toast-${++toastIdCounter}`;
			const toast: Toast = { id, message, type, action };

			setToasts((current) => [...current, toast]);

			// Auto-dismiss after 4 seconds
			setTimeout(() => {
				setToasts((current) => current.filter((t) => t.id !== id));
			}, 4000);
		},
		[],
	);
```

- [ ] **Step 2: Render the link in the container**

In `src/components/toast-container.tsx`, add `import Link from "next/link";` at the top (below the `"use client";` line / existing imports), and replace the `<div className="toast-message">{toast.message}</div>` line with:

```tsx
					<div className="toast-message">
						{toast.action ? (
							<Link
								href={toast.action.href}
								className="toast-link"
								onClick={() => removeToast(toast.id)}
							>
								{toast.message}
							</Link>
						) : (
							toast.message
						)}
					</div>
```

- [ ] **Step 3: Add minimal link styling**

Append to `src/app/globals.css`:

```css
.toast-link {
	color: inherit;
	text-decoration: underline;
	cursor: pointer;
}
```

- [ ] **Step 4: Verify static checks**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all pass. Existing `showToast` call sites still compile (the new arg is optional).

- [ ] **Step 5: Commit**

```bash
git add src/lib/toast-context.tsx src/components/toast-container.tsx src/app/globals.css
git commit -m "Support optional click-through href on toasts"
```

---

### Task 3: `useCurrentUserId` hook (paginated id resolution)

**Files:**
- Create: `src/lib/use-current-user-id.ts`

**Interfaces:**
- Consumes: `getApiV1IamUsers` from `src/lib/api/generated/client`.
- Produces: `useCurrentUserId(currentUsername: string | null): number | null`.

- [ ] **Step 1: Implement the hook**

Create `src/lib/use-current-user-id.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiV1IamUsers } from "@/lib/api/generated/client";

async function resolveCurrentUserId(username: string): Promise<number | null> {
	let cursor: string | undefined;

	// Safety cap: avoid an unbounded loop if the cursor never terminates.
	for (let page = 0; page < 50; page += 1) {
		const response = await getApiV1IamUsers(
			{ limit: 250, cursor },
			{ credentials: "include" },
		);

		if (response.status !== 200) {
			return null;
		}

		const match = response.data.find((user) => user.username === username);
		if (match) {
			return match.id;
		}

		const nextCursor = response.headers.get("x-next-cursor");
		if (!nextCursor) {
			return null;
		}
		cursor = nextCursor;
	}

	return null;
}

export function useCurrentUserId(currentUsername: string | null): number | null {
	const query = useQuery({
		queryKey: ["current-user-id", currentUsername],
		queryFn: async () => resolveCurrentUserId(currentUsername as string),
		enabled: Boolean(currentUsername),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});

	return query.data ?? null;
}
```

- [ ] **Step 2: Verify static checks**

Run: `npm run lint && npm run typecheck`
Expected: both pass. (`getApiV1IamUsers` accepts `{ limit, cursor }` — both optional in `GetApiV1IamUsersParams` — and returns `{ data, status, headers }`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/use-current-user-id.ts
git commit -m "Add useCurrentUserId hook with paginated username lookup"
```

---

### Task 4: Shell wiring — my-tasks poll, toasts, personal badge, lastSeen

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/(protected)/layout.tsx`

**Interfaces:**
- Consumes: `useCurrentUserId` (Task 3); `filterMine`, `diffNewlyTerminal`, `countUnread`, `toastForTransition` (Task 1); `showToast` (Task 2); `fetchTasks`, `isTerminalTaskStatus`, `TaskRecord` (`src/lib/api/tasking.ts`); `useToast` (`src/lib/toast-context`).
- Produces: `AppShell` now requires a `currentUsername: string | null` prop.

This task replaces the old all-tasks summary poll and the `recentFailureUntil` flash with the personal notifications model.

- [ ] **Step 1: Pass `currentUsername` from the protected layout**

In `src/app/(protected)/layout.tsx`, change the render line:

```tsx
	return (
		<AppShell canViewAdmin={canViewAdmin} currentUsername={session.username ?? null}>
			{children}
		</AppShell>
	);
```

- [ ] **Step 2: Update imports and props in `app-shell.tsx`**

Add these imports (near the other `@/lib` imports):

```ts
import { fetchTasks, isTerminalTaskStatus, type TaskRecord } from "@/lib/api/tasking";
import {
	countUnread,
	diffNewlyTerminal,
	filterMine,
	toastForTransition,
} from "@/lib/task-notifications";
import { useToast } from "@/lib/toast-context";
import { useCurrentUserId } from "@/lib/use-current-user-id";
```

Remove the now-unused tasking import block:

```ts
import {
	fetchTasks,
	summarizeTaskActivity,
	type TaskActivitySummary,
} from "@/lib/api/tasking";
```

(`fetchTasks` is re-added in the combined import above; `summarizeTaskActivity` and `TaskActivitySummary` are no longer used.)

Update the props type:

```ts
type AppShellProps = {
	canViewAdmin: boolean;
	currentUsername: string | null;
	children: ReactNode;
};
```

And the component signature:

```ts
export function AppShell({ canViewAdmin, currentUsername, children }: AppShellProps) {
```

- [ ] **Step 3: Remove the old summary fetch helper**

Delete the `fetchRecentTaskSummary` function:

```ts
async function fetchRecentTaskSummary(): Promise<TaskActivitySummary> {
	const page = await fetchTasks({
		limit: 50,
		sort: "created_at.desc,id.desc",
	});

	return summarizeTaskActivity(page.tasks);
}
```

- [ ] **Step 4: Replace the summary query, failure state, and add notifications state**

Delete the `taskSummaryQuery` definition:

```ts
	const taskSummaryQuery = useQuery({
		queryKey: ["tasks", "shell-summary"],
		queryFn: fetchRecentTaskSummary,
		refetchInterval: (query) => {
			const activeTasks = query.state.data?.activeTasks ?? 0;
			const isHidden =
				typeof document !== "undefined" &&
				document.visibilityState === "hidden";

			if (isHidden) {
				return activeTasks > 0 ? 15000 : 30000;
			}

			return activeTasks > 0 ? 5000 : 15000;
		},
	});
```

Delete the `recentFailureUntil` state and the `previousFailedTasksRef`:

```ts
	const [recentFailureUntil, setRecentFailureUntil] = useState<number | null>(
		null,
	);
```

```ts
	const previousFailedTasksRef = useRef<number | null>(null);
```

Add, near the other hooks (after `const searchParams = useSearchParams();` and the `useRouter` line):

```ts
	const { showToast } = useToast();
	const currentUserId = useCurrentUserId(currentUsername);
	const prevMyTasksRef = useRef<TaskRecord[] | null>(null);
	const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);

	const myTasksQuery = useQuery({
		queryKey: ["tasks", "shell-mine", currentUserId],
		queryFn: async () => {
			const page = await fetchTasks({
				submittedBy: currentUserId ?? undefined,
				limit: 50,
				sort: "created_at.desc,id.desc",
			});
			const mine = filterMine(page.tasks, currentUserId as number);
			return { mine, pageFull: page.tasks.length === 50 };
		},
		enabled: currentUserId != null,
		refetchInterval: (query) => {
			const mine = query.state.data?.mine ?? [];
			const hasActive = mine.some((task) => !isTerminalTaskStatus(task.status));
			const isHidden =
				typeof document !== "undefined" &&
				document.visibilityState === "hidden";

			if (isHidden) {
				return hasActive ? 15000 : 30000;
			}

			return hasActive ? 5000 : 15000;
		},
	});
```

- [ ] **Step 5: Add the lastSeen + transition effects**

Add these effects (place them after the existing effects, e.g. after the keyboard-help effect block):

```ts
	useEffect(() => {
		if (currentUserId == null) {
			return;
		}

		const key = `hubuum.tasks.lastSeenAt.${currentUserId}`;
		const stored = window.localStorage.getItem(key);
		if (stored == null) {
			const now = Date.now();
			window.localStorage.setItem(key, String(now));
			setLastSeenAt(now);
			return;
		}

		const parsed = Number.parseInt(stored, 10);
		setLastSeenAt(Number.isNaN(parsed) ? 0 : parsed);
	}, [currentUserId]);

	useEffect(() => {
		if (currentUserId == null || !pathname.startsWith("/tasks")) {
			return;
		}

		const now = Date.now();
		window.localStorage.setItem(
			`hubuum.tasks.lastSeenAt.${currentUserId}`,
			String(now),
		);
		setLastSeenAt(now);
	}, [pathname, currentUserId]);

	useEffect(() => {
		const data = myTasksQuery.data;
		if (!data) {
			return;
		}

		for (const task of diffNewlyTerminal(prevMyTasksRef.current, data.mine)) {
			const { message, type } = toastForTransition(task);
			showToast(message, type, { href: `/tasks/${task.id}` });
		}

		prevMyTasksRef.current = data.mine;
	}, [myTasksQuery.data, showToast]);
```

- [ ] **Step 6: Replace the badge derivation**

Delete the old derivation:

```ts
	const activeTaskCount = taskSummaryQuery.data?.activeTasks ?? 0;
	const hasRecentFailure =
		recentFailureUntil !== null && recentFailureUntil > Date.now();
	const taskBadgeLabel =
		activeTaskCount > 0
			? String(activeTaskCount)
			: hasRecentFailure
				? "!"
				: null;
	const taskBadgeTone = hasRecentFailure ? "danger" : "accent";
```

Replace with:

```ts
	const myTasks = myTasksQuery.data?.mine ?? [];
	const pageFull = myTasksQuery.data?.pageFull ?? false;
	const activeTaskCount = myTasks.filter(
		(task) => !isTerminalTaskStatus(task.status),
	).length;
	const unread =
		lastSeenAt == null
			? { unreadCount: 0, hasUnreadFailure: false, isSaturated: false }
			: countUnread(myTasks, lastSeenAt, pageFull);

	let taskBadgeLabel: string | null = null;
	let taskBadgeTone: "accent" | "danger" = "accent";
	if (unread.unreadCount > 0) {
		taskBadgeLabel = unread.isSaturated
			? `${unread.unreadCount}+`
			: String(unread.unreadCount);
		taskBadgeTone = unread.hasUnreadFailure ? "danger" : "accent";
	} else if (activeTaskCount > 0) {
		taskBadgeLabel = String(activeTaskCount);
		taskBadgeTone = "accent";
	}
```

- [ ] **Step 7: Delete the two failure-tracking effects**

Delete the effect that sets `recentFailureUntil` from `taskSummaryQuery`:

```ts
	useEffect(() => {
		const failedTasks = taskSummaryQuery.data?.failedTasks ?? null;
		if (failedTasks === null) {
			return;
		}

		const previousFailedTasks = previousFailedTasksRef.current;
		previousFailedTasksRef.current = failedTasks;

		if (previousFailedTasks !== null && failedTasks > previousFailedTasks) {
			setRecentFailureUntil(Date.now() + 60_000);
		}
	}, [taskSummaryQuery.data?.failedTasks]);
```

And the effect that clears it on a timer:

```ts
	useEffect(() => {
		if (recentFailureUntil === null) {
			return;
		}

		const remainingMs = recentFailureUntil - Date.now();
		if (remainingMs <= 0) {
			setRecentFailureUntil(null);
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setRecentFailureUntil(null);
		}, remainingMs);

		return () => window.clearTimeout(timeoutId);
	}, [recentFailureUntil]);
```

(`renderTaskBadge`, `taskBadgeLabel`, and `taskBadgeTone` usages elsewhere are unchanged — they read the new variables.)

- [ ] **Step 8: Verify static checks**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all pass. If lint/typecheck reports an unused symbol (`summarizeTaskActivity`, `TaskActivitySummary`, `useQuery` still used elsewhere — keep it), remove only the genuinely unused ones. `useRef`, `useState`, `useEffect`, `useQuery` remain used.

- [ ] **Step 9: Commit**

```bash
git add src/components/app-shell.tsx "src/app/(protected)/layout.tsx"
git commit -m "Wire personal task notifications: toasts, unread badge, lastSeen"
```

---

### Task 5: Scope `/tasks` to my tasks

**Files:**
- Modify: `src/components/tasks-workspace.tsx`
- Modify: `src/app/(protected)/tasks/page.tsx`

**Interfaces:**
- Consumes: `useCurrentUserId` (Task 3), `filterMine` (Task 1), `fetchTasks` (already imported in the file).
- Produces: `TasksWorkspace` now accepts `currentUsername: string | null`.

- [ ] **Step 1: Pass `currentUsername` from the tasks page**

Replace `src/app/(protected)/tasks/page.tsx` with:

```tsx
import { TasksWorkspace } from "@/components/tasks-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function TasksPage() {
	const session = await requireServerSession();

	return <TasksWorkspace currentUsername={session.username ?? null} />;
}
```

- [ ] **Step 2: Accept the prop and scope the query in `TasksWorkspace`**

In `src/components/tasks-workspace.tsx`:

Add imports (with the other `@/lib` imports):

```ts
import { filterMine } from "@/lib/task-notifications";
import { useCurrentUserId } from "@/lib/use-current-user-id";
```

Add a props type and update the component signature. Replace:

```tsx
export function TasksWorkspace() {
	const router = useRouter();
```

with:

```tsx
type TasksWorkspaceProps = {
	currentUsername: string | null;
};

export function TasksWorkspace({ currentUsername }: TasksWorkspaceProps) {
	const router = useRouter();
	const currentUserId = useCurrentUserId(currentUsername);
```

Replace the `issuedTasksQuery` definition's `queryKey` and `queryFn` with the scoped version (leave `refetchInterval` unchanged — it still reads `query.state.data` as a task array):

```tsx
	const issuedTasksQuery = useQuery({
		queryKey: ["tasks", "workspace-list", currentUserId],
		queryFn: async () => {
			const page = await fetchTasks({
				submittedBy: currentUserId ?? undefined,
				limit: 50,
				sort: "created_at.desc,id.desc",
			});
			return currentUserId != null
				? filterMine(page.tasks, currentUserId)
				: page.tasks;
		},
```

- [ ] **Step 3: Verify static checks**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks-workspace.tsx "src/app/(protected)/tasks/page.tsx"
git commit -m "Scope /tasks to the current user's tasks"
```

---

## Self-Review

**Spec coverage:**
- Pure logic (`filterMine`/`diffNewlyTerminal`/`countUnread`/`toastForTransition`) + Vitest → Task 1. ✓
- CI runs tests → Task 1 Step 7. ✓
- Toast click-through → Task 2. ✓
- `useCurrentUserId` paginated lookup → Task 3. ✓
- Shell: my-tasks poll, `submittedBy` + `filterMine`, transitions→toasts, personal badge (unread priority, `N+`, danger on failure), `lastSeenAt` per-user key + mount baseline + `/tasks` reset, remove `recentFailureUntil` → Task 4. ✓
- `/tasks` scoped to my tasks → Task 5. ✓
- Id-unresolved fallback: poll `enabled: currentUserId != null` (disabled), `lastSeenAt` gated on id, badge shows nothing → Task 4. ✓ `/tasks` falls back to unscoped fetch → Task 5 Step 2 (`currentUserId != null ? filterMine : page.tasks`). ✓
- Intentional behavior changes (personal badge, personal `/tasks`, persistent failure) → realized in Tasks 4–5.

**Placeholder scan:** No TBD/TODO; every code step has complete code; test code is concrete.

**Type consistency:** `filterMine(tasks, myId)`, `diffNewlyTerminal(prev, next)`, `countUnread(myTasks, lastSeenAt, pageFull)` returning `{ unreadCount, hasUnreadFailure, isSaturated }`, `toastForTransition(task)` returning `{ message, type }`, and `useCurrentUserId(currentUsername)` are used with identical signatures across Tasks 1, 3, 4, 5. `myTasksQuery.data` shape `{ mine, pageFull }` is consistent between definition and consumers. `showToast(message, type, { href })` matches Task 2's signature.

**Note on TDD scope:** Only the pure module (Task 1) is unit-tested — that is where the logic and the risk live. Tasks 2–5 are React/integration/CSS wiring with no test runner for the DOM; they are verified via `lint`/`typecheck`/`build` and manual checks, consistent with the repo.
