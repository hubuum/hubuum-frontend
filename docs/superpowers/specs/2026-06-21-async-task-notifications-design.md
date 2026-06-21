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

### "My tasks" must be filtered client-side (do not trust the server param)

The list endpoint documents `submitted_by` as **"effective only for admins"**
(`src/lib/api/generated/models/getApiV1TasksParams.ts`). The assumed backend contract
is that non-admins are already scoped to their own tasks (which is why the filter is
admin-only), while admins see all tasks and can narrow with `submitted_by`. The design
does **not depend on that assumption**:

- Always pass `submitted_by: myId` (server-side narrowing for admins; a harmless no-op
  for non-admins).
- **Always also filter the fetched list client-side to `task.submitted_by === myId`.**
  This is the correctness guarantee: even if a non-admin backend returns a broader set,
  no other user's task can produce a toast, an unread count, or an active count.

All logic functions below operate on the already-client-filtered "my" list.

### Intentional behavior changes (call-outs)

- The Tasks sidebar badge becomes **personal** — it reflects the current user's tasks,
  not all visible tasks.
- The failure indication **persists until you visit `/tasks`**, replacing the current
  `recentFailureUntil` 60-second flash.

---

## Components

### 1. Pure logic — `src/lib/task-notifications.ts`

No React, no I/O. Unit-tested with Vitest.

- `filterMine(tasks, myId)` → tasks where `submitted_by === myId`. The single
  client-side guarantee from Finding 1; applied to every fetched list before any other
  function runs.
- `diffNewlyFinished(prevFinished, nextFinished)` → returns the terminal tasks present
  in `nextFinished` but absent (by `id`) from `prevFinished`. Both inputs are the "my +
  terminal" lists sorted `finished_at.desc` from consecutive polls, so a task absent
  from `prev` but present in `next` is one that **just finished** — regardless of how
  old it is (this is what makes long-running tasks reliable, see Finding 2 below). The
  caller skips the very first poll (`prev` is null) so the load-time backlog never
  toasts.
- `countUnread(finishedTasks, lastSeenAt)` → `{ unreadCount, hasUnreadFailure }` where
  unread = terminal tasks with `finished_at` strictly after `lastSeenAt`;
  `hasUnreadFailure` is true if any unread task is `failed` or `partially_succeeded`.
  `unreadCount` is capped at the fetched window (see cap note); expose it as e.g. `50+`
  if the window is full and all are unread.
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

Two purpose-built polls replace `fetchRecentTaskSummary`, both enabled once `myId` is
known, both passing `submittedBy: myId`, both client-filtered to `submitted_by ===
myId`, and both sharing the existing adaptive `refetchInterval` (active → 5s/15s,
hidden → 15s/30s):

1. **Finished poll** — `fetchTasks({ submittedBy: myId, limit: 50, sort:
   "finished_at.desc,id.desc" })`, then keep only terminal tasks. Drives completion
   toasts and the unread count. Sorting by `finished_at` (not `created_at`) is what
   makes a long-running, old task surface the moment it finishes.
2. **Active poll** — `fetchTasks({ submittedBy: myId, limit: 50, sort:
   "created_at.desc,id.desc" })`, then count non-terminal tasks. Drives the
   in-progress count for the badge fallback. (Acceptable limitation: a non-terminal
   task older than the newest 50-by-creation is not counted; this only affects the
   secondary active count, never completions/unread.)

On each successful **finished** poll:
- Run `diffNewlyFinished(prevFinishedRef.current, finished)`; for each result call
  `showToast(message, type, { href: "/tasks/<id>" })`. Skip when
  `prevFinishedRef.current` is null (baseline / first poll).
- Update `prevFinishedRef.current = finished`.

Badge derivation from `countUnread(finished, lastSeenAt)` and the active count:
- `unreadCount > 0` → label = `unreadCount` (or `50+`), tone = `danger` if
  `hasUnreadFailure` else `accent`.
- else `activeCount > 0` → label = `activeCount`, tone `accent` (preserves today's
  in-progress indicator).
- else no badge.
- Remove the `recentFailureUntil` state and its effects (superseded by unread).

`lastSeenAt` lives in `localStorage` under a **per-user key**
`hubuum.tasks.lastSeenAt.<myId>` (ms epoch as string) so a shared browser never lets
one account clear or baseline another's unread state (Finding 3):
- On mount (once `myId` is known): if the key is missing, initialize to `Date.now()`
  (baseline so the backlog isn't "unread").
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
resolve myId (username→id, cached)
   │
   ├─ finished poll: fetchTasks(submittedBy=myId, sort finished_at.desc) ─┐
   │     client-filter submitted_by===myId, keep terminal                 │ finished[]
   │                                                                       ▼
   │   diffNewlyFinished(prevFinishedRef, finished) ─> showToast(..., {href:/tasks/id})
   │   countUnread(finished, lastSeenAt) ─> {unreadCount, hasUnreadFailure} ┐
   │                                                                        ▼
   └─ active poll: fetchTasks(submittedBy=myId, sort created_at.desc) ─> activeCount
                                                                            │
                              badge: unread>0 ? unread(danger if fail) : active
   lastSeenAt (localStorage hubuum.tasks.lastSeenAt.<myId>)
        ◄── set to now on mount-if-missing and on /tasks visit
```

## Error / edge handling

- **First load:** `prevFinishedRef` null → no toasts; `lastSeenAt` initialized to now →
  no unread backlog.
- **Id unresolved:** graceful fallback — neither poll is enabled, no toasts, and the
  badge shows nothing task-related (we never fetch an unfiltered list, so we never show
  another user's tasks). This is a deliberate, safe degradation.
- **`finished_at` missing:** terminal tasks normally carry `finished_at`; if absent,
  fall back to `started_at`/`created_at` for the unread comparison so such a task isn't
  silently dropped.
- **Window cap (> 50 between polls):** if more than 50 of my tasks finish within one
  poll interval, completions beyond the newest 50 are not toasted, and `unreadCount`
  saturates at `50+`. Given the 5–15s interval this is a rare tail; documented rather
  than paginated (YAGNI). The `/tasks` page remains the complete record.
- **Tab hidden:** existing interval already backs off; toasts appear on next foreground
  poll.
- **On `/tasks` when a task finishes:** a toast may still fire (harmless); `lastSeenAt`
  keeps the badge at zero.

## Testing

- **Vitest** added (minimal config + `"test": "vitest run"` script). Unit tests for
  `diffNewlyFinished` (newly-finished detected; present-in-both ignored; baseline/empty
  prev; a task dropping out of the window produces no false positive), `countUnread`
  (boundary on `lastSeenAt`, failure flag, missing `finished_at` fallback, `50+`
  saturation), and `toastForTransition` (type + message per status). Pure functions, so
  the client-side `submitted_by === myId` filtering is exercised by passing pre-filtered
  lists plus one test asserting the filter helper drops foreign tasks.
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
