# Async Task Notifications (toast + Tasks badge) — Design

Date: 2026-06-21
Status: Proposed

## Problem

Imports and reports run as async backend tasks. Today the only way to learn an
outcome is to sit on the `/tasks` page (or a task detail page) and watch. If you
navigate away, you miss the result. The shell shows a Tasks sidebar badge for active
counts and flashes a transient "!" on new failures, but there is no "your task
finished" signal and no durable "you have unseen results" indication.

## Decision

Notify the current user when **their own** async tasks reach a terminal state:

1. A **toast** when a task transitions non-terminal → terminal while the app is open
   (clickable, navigates to the task detail).
2. A durable **unread indicator on the existing Tasks sidebar badge**; the `/tasks`
   page is the catch-up "inbox". Visiting `/tasks` clears the unread state.

Chosen data model (Approach A): **derive everything from the polled task list plus a
`localStorage` "last seen" timestamp.** No parallel notification store, no backend
changes. This is consistent with backend truth, survives reload, and needs no
schema/dedup/pruning. (Rejected: B — persisting notification objects in localStorage,
more code and drift; C — backend-backed notifications, no endpoint exists, YAGNI.)

### Scope

- Notifications cover **only tasks submitted by the current user** (`submitted_by ==
  my id`).
- Terminal statuses (from `isTerminalTaskStatus`): `succeeded`, `failed`,
  `partially_succeeded`, `cancelled`.
- No topbar bell, no dropdown. The inbox is the existing `/tasks` page (no markup
  changes to that page in v1; row-level "new" highlighting is a possible follow-up).

### Intentional behavior changes (call-outs)

- The Tasks sidebar badge becomes **personal** — it reflects the current user's tasks,
  not all visible tasks.
- The failure indication **persists until you visit `/tasks`**, replacing the current
  `recentFailureUntil` 60-second flash.

---

## Components

### 1. Pure logic — `src/lib/task-notifications.ts`

No React, no I/O. Unit-tested with Vitest.

- `diffTaskTransitions(prev, next)` → returns the tasks in `next` whose status is
  terminal but whose matching task (by `id`) in `prev` was non-terminal. Tasks absent
  from `prev` are NOT transitions (avoids toasting the load-time backlog and newly
  appearing already-finished tasks). Operates on already-"mine" lists.
- `countUnread(tasks, lastSeenAt)` → `{ unreadCount, hasUnreadFailure }` where unread =
  terminal tasks with `finished_at` strictly after `lastSeenAt`; `hasUnreadFailure` is
  true if any unread task is `failed` or `partially_succeeded`.
- `toastForTransition(task)` → `{ message, type }` where `type` is `success`
  (succeeded), `error` (failed), or `info` (partially_succeeded / cancelled), and the
  message reads e.g. `Import #42 succeeded` / `Report #41 failed` (kind capitalized +
  `#id` + status phrase, using `summary` when present).

Types reuse `TaskRecord`/`TaskStatus`/`TaskKind` and `isTerminalTaskStatus` from
`src/lib/api/tasking.ts`.

### 2. Current-user id resolution

A cached React Query resolving the current user's numeric id by reusing the account
page's approach: call `getApiV1IamUsers(...)` and match the row whose `username`
equals the session username (the username is already passed into the shell tree — the
protected layout has `session.username`; plumb it to `AppShell` as a prop, mirroring
`canViewAdmin`). Returns `number | null`.

- If id resolution fails or returns null, the feature **degrades gracefully**: no
  completion toasts, and the badge falls back to today's all-tasks active behavior.

### 3. Shell wiring — `src/components/app-shell.tsx`

- Replace `fetchRecentTaskSummary` usage so the poll fetches **my** recent tasks:
  `fetchTasks({ submittedBy: myId, limit: 50, sort: "created_at.desc,id.desc" })`,
  enabled once `myId` is known. Keep the existing adaptive `refetchInterval`
  (active → 5s/15s, hidden → 15s/30s).
- Keep a `useRef` of the previous poll's task list. On each successful poll:
  - Run `diffTaskTransitions(prevRef.current, tasks)`; for each transition call
    `showToast(message, type)` with a click target of `/tasks/[id]`. Skip when
    `prevRef.current` is null (baseline / first poll).
  - Update `prevRef.current = tasks`.
- Derive the badge from `countUnread(tasks, lastSeenAt)`:
  - `unreadCount > 0` → label = `unreadCount`, tone = `danger` if `hasUnreadFailure`
    else `accent`.
  - else `activeTaskCount > 0` → label = `activeTaskCount`, tone `accent` (existing
    behavior).
  - else no badge.
  - Remove the `recentFailureUntil` state and its effects.
- `lastSeenAt` lives in `localStorage` (`hubuum.tasks.lastSeenAt`, ms epoch as string):
  - On mount: if missing, initialize to `Date.now()` (baseline so the backlog isn't
    "unread").
  - When `pathname` starts with `/tasks`: set `lastSeenAt = Date.now()` and persist
    (clears the unread badge). Held in React state so the badge updates immediately.

### Toast click target

Toasts must be clickable and route to `/tasks/[id]`. The current toast system
(`toast-context.tsx` / `toast-container.tsx`) supports only a message + type. Extend
it minimally to accept an optional action: `showToast(message, type, action?)` where
`action = { href }`. `ToastContainer` wraps the message in a link/button when `action`
is present and dismisses on click. Existing call sites are unaffected (optional arg).

---

## Data flow

```
poll (mine, every 5–30s)
   │  tasks: TaskRecord[]
   ▼
diffTaskTransitions(prevRef, tasks) ──> per transition: showToast(..., {href:/tasks/id})
   │
countUnread(tasks, lastSeenAt) ──> { unreadCount, hasUnreadFailure } ──> sidebar badge
   ▲
lastSeenAt (localStorage)  ◄── set to now on mount-if-missing and on /tasks visit
```

## Error / edge handling

- **First load:** `prevRef` null → no toasts; `lastSeenAt` initialized to now → no
  unread backlog.
- **Id unresolved:** graceful fallback described above.
- **Clock/`finished_at` missing:** terminal tasks normally carry `finished_at`; if
  absent, fall back to `started_at`/`created_at` for the unread comparison so such a
  task isn't silently dropped.
- **Tab hidden:** existing interval already backs off; toasts simply appear on next
  foreground poll.
- **On `/tasks` when a task finishes:** a toast may still fire (harmless); `lastSeenAt`
  keeps the badge at zero.

## Testing

- **Vitest** added (minimal config + `"test": "vitest run"` script). Unit tests for
  `diffTaskTransitions` (transition detected; absent-in-prev ignored; non-terminal→
  non-terminal ignored; terminal→terminal ignored), `countUnread` (boundary on
  `lastSeenAt`, failure flag, missing `finished_at` fallback), and `toastForTransition`
  (type + message per status).
- Wire `npm test` into `.github/workflows/ci.yml`.
- Static: `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Manual: kick off an import; navigate away; confirm a clickable toast on completion
  and the Tasks badge showing unread (danger tone on failure); visiting `/tasks`
  clears it; reload preserves unread state until `/tasks` is visited.

## Files

- Create: `src/lib/task-notifications.ts`, `src/lib/task-notifications.test.ts`,
  `vitest.config.ts`.
- Modify: `src/components/app-shell.tsx` (poll mine, transitions, badge, lastSeen;
  remove `recentFailureUntil`); `src/app/(protected)/layout.tsx` +
  `AppShell` props (pass `currentUsername`); `src/lib/toast-context.tsx` +
  `src/components/toast-container.tsx` (optional action/href); `package.json`
  (vitest dep + test script); `.github/workflows/ci.yml` (run tests).
