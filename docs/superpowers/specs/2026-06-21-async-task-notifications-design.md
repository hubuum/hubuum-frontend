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
- No topbar bell, no dropdown. The inbox is the existing `/tasks` page, **scoped to my
  tasks** so it always matches the badge's window. Row-level "new" highlighting is a
  possible follow-up.

### "My tasks" must be filtered client-side (do not trust the server param)

The list endpoint documents `submitted_by` as **"effective only for admins"**
(`src/lib/api/generated/models/getApiV1TasksParams.ts`). The assumed backend contract
is that non-admins are already scoped to their own tasks (which is why the filter is
admin-only), while admins see all tasks and can narrow with `submitted_by`.

There are two distinct guarantees here, with different dependencies — do not conflate
them:

- **Safety (no foreign notifications) — unconditional.** Always filter the fetched list
  client-side to `task.submitted_by === myId` (`filterMine`). No other user's task can
  ever produce a toast, unread count, or active count, regardless of backend behavior.
  We also pass `submitted_by: myId` to the request.
- **Completeness (all of *my* tasks appear in the window) — conditional.** This depends
  on the backend scoping the list to me *before* applying `limit`. For admins,
  `submitted_by: myId` does this server-side (works). For non-admins it is a no-op and
  we rely on the documented self-scoping. If a non-admin backend instead returned a
  broad list and applied `limit: 50` before scoping, other users' tasks could fill the
  window and one of my tasks could be missed. That is the same *class* of limitation as
  the documented window bound (Edge handling) — a completeness gap, **not** a safety
  hole. This dependency is explicit and should be confirmed against the backend; if it
  does not hold, a server-side "my tasks" query (API change) would be required for
  full completeness.

All logic functions below operate on the already-`filterMine`d "my" list.

### Intentional behavior changes (call-outs)

- The Tasks sidebar badge becomes **personal** — it reflects the current user's tasks,
  not all visible tasks.
- The `/tasks` page becomes **personal too** — it lists only the current user's tasks
  (previously it showed all tasks visible to the account, i.e. all tasks for admins).
  Any task remains reachable by id via the existing task lookup on that page.
- The failure indication **persists until you visit `/tasks`**, replacing the current
  `recentFailureUntil` 60-second flash.

---

## Components

### 1. Pure logic — `src/lib/task-notifications.ts`

No React, no I/O. Unit-tested with Vitest.

- `filterMine(tasks, myId)` → tasks where `submitted_by === myId`. The single
  client-side guarantee from Finding 1; applied to the fetched list before any other
  function runs.
- `diffNewlyTerminal(prev, next)` → returns tasks in `next` whose status is terminal
  but whose matching task (by `id`) in `prev` was non-terminal. Both inputs are the
  "my" lists from consecutive polls (sorted `created_at.desc`). In the common case a
  finishing task is recent and still inside the newest-50 window, so it was present in
  `prev` as non-terminal and its completion is caught; the bounded-window limitation
  (Edge handling) applies if I created 50+ newer tasks while it ran. Tasks absent from
  `prev` are not transitions (avoids toasting the load-time backlog). The caller skips
  the first poll (`prev` null).
- `countUnread(myTasks, lastSeenAt, pageFull)` → `{ unreadCount, hasUnreadFailure,
  isSaturated }` over the terminal tasks in the list: unread = terminal whose
  effective completion time `finished_at ?? started_at ?? created_at` is strictly after
  `lastSeenAt` (the fallback covers terminal tasks missing `finished_at`);
  `hasUnreadFailure` true if any unread task is `failed` or `partially_succeeded`. `isSaturated = pageFull`, supplied by the caller
  as `page.tasks.length === limit` (50). Rationale: when the page is full there are
  tasks beyond the newest-50 window that we never examined, so `unreadCount` is a
  **lower bound** — the window is `created_at`-ordered while unread is by `finished_at`,
  so an older task outside the window can be unread regardless of the visible tasks'
  states; we cannot cheaply infer exactness. When the page is not full we have fetched
  *all* of my tasks, so the count is exact. The badge renders `${unreadCount}+` when
  `isSaturated`, else `${unreadCount}`; the `+` is a conservative "at least, possibly
  more" hint, not an exact overflow flag.
- `toastForTransition(task)` → `{ message, type }` where `type` is `success`
  (succeeded), `error` (failed), or `info` (partially_succeeded / cancelled), and the
  message reads e.g. `Import #42 succeeded` / `Report #41 failed` (kind capitalized +
  `#id` + status phrase, using `summary` when present).

Types reuse `TaskRecord`/`TaskStatus`/`TaskKind` and `isTerminalTaskStatus` from
`src/lib/api/tasking.ts`.

### 2. Current-user id resolution

A cached React Query resolving the current user's numeric id: call
`getApiV1IamUsers({ limit: 250 })` and match the row whose `username` equals the session
username. Non-admins receive a **self-only** list (the endpoint is self-scoped for them
— the account page already relies on this via its `users.length === 1` fallback), so the
match is on the first page. Admins receive the full user list (default 100, **max
250**); if the username is not found in the first page, **follow the `X-Next-Cursor`
header and keep fetching until the username matches or pages are exhausted**. There is
no `/me` endpoint and no username filter on `/iam/users` (confirmed against
`openapi.json`), so cursor pagination is the only reliable lookup — this is a
deliberate improvement over the account page's first-page-only match, which silently
fails for admins beyond page 1. The resolved id is cached for the session (resolved
once). Returns `number | null`; null → feature disabled (see Edge handling).

Expose it as a reusable hook `useCurrentUserId(currentUsername)` (e.g.
`src/lib/use-current-user-id.ts`) consumed by **both** `AppShell` and `TasksWorkspace`,
so the badge and the now-scoped `/tasks` page resolve the same id. The session username
is plumbed in from the server components that already have it: `AppShell` via a new prop
from `(protected)/layout.tsx` (mirroring `canViewAdmin`), and `TasksWorkspace` via a new
prop from `(protected)/tasks/page.tsx` (which has `session.username`).

- If id resolution fails or returns null, the feature **is disabled** (this is the
  single, authoritative fallback — matches Edge handling): the poll is not enabled, no
  toasts fire, and the Tasks badge shows nothing task-related. We do **not** fall back
  to an all-tasks view, since that could surface other users' tasks and contradicts the
  personal scoping.

### 3. Shell wiring — `src/components/app-shell.tsx`

A single poll replaces `fetchRecentTaskSummary`, enabled once `myId` is known:
`fetchTasks({ submittedBy: myId, limit: 50, sort: "created_at.desc,id.desc" })` then
`filterMine(...)`. It keeps the existing adaptive `refetchInterval` (active → 5s/15s,
hidden → 15s/30s). One poll (not two) keeps request volume identical to today.

Why `created_at.desc`, not `finished_at.desc`: the window is now 50 of **my** tasks, so
a running task only leaves it if I personally create 50+ newer tasks while it runs —
rare for one user. `created_at` is always present, so this avoids depending on the
backend's unspecified NULL-`finished_at` sort ordering (if nulls sorted first under
`finished_at.desc`, active tasks would fill the window and starve completions). The
cost is a documented bound (see Edge handling).

On each successful poll (with `mine = filterMine(page.tasks, myId)`):
- Run `diffNewlyTerminal(prevRef.current, mine)`; for each result call
  `showToast(message, type, { href: "/tasks/<id>" })`. Skip when `prevRef.current` is
  null (baseline / first poll).
- Update `prevRef.current = mine`.

Badge derivation from `countUnread(mine, lastSeenAt, pageFull)` (with `pageFull =
page.tasks.length === 50`) and the active count
(`mine.filter((t) => !isTerminalTaskStatus(t.status)).length`):
- `unreadCount > 0` → label = `isSaturated ? unreadCount + "+" : String(unreadCount)`,
  tone = `danger` if `hasUnreadFailure` else `accent`.
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
   ▼
poll: fetchTasks(submittedBy=myId, limit 50, sort created_at.desc)   every 5–30s
   │  mine = filterMine(page.tasks, myId)
   ├─ diffNewlyTerminal(prevRef, mine) ─> per transition: showToast(..., {href:/tasks/id})
   ├─ countUnread(mine, lastSeenAt, pageFull) ─> {unreadCount, hasUnreadFailure, isSaturated} ┐
   └─ activeCount = mine.filter(non-terminal).length                   │
                                                                       ▼
                       badge: unread>0 ? unread(danger if fail) : activeCount
   lastSeenAt (localStorage hubuum.tasks.lastSeenAt.<myId>)
        ◄── set to now on mount-if-missing and on /tasks visit
```

## Error / edge handling

- **First load:** `prevRef` null → no toasts; `lastSeenAt` initialized to now → no
  unread backlog.
- **Id unresolved:** graceful fallback — the poll is not enabled, no toasts, and the
  badge shows nothing task-related (we never fetch an unfiltered list, so we never show
  another user's tasks). Deliberate, safe degradation.
- **`finished_at` missing:** such terminal tasks are still in the window (it sorts by
  `created_at`, which they have), so unread falls back to `started_at`/`created_at` for
  the comparison and the task is not dropped.
- **Window bound (50 of my newest-by-creation):** a task is only missed if I personally
  have 50+ tasks created after it while it is still running — rare for one user. When it
  happens, that task never toasts and isn't counted as unread; it is still reachable on
  its own `/tasks/<id>` detail page. `unreadCount` saturates at `50+`. Documented rather
  than paginated (YAGNI).
- **`/tasks` consistency:** the `/tasks` list is now scoped to my tasks with the same
  `submitted_by=myId, created_at.desc, limit 50` window as the shell poll, so the badge
  and the page show the same set — visiting `/tasks` never clears unread for a task it
  doesn't display. The toast's deep-link to `/tasks/<id>` remains the authoritative
  per-task record; `/tasks` is not an exhaustive history.
- **`/tasks` when id is unresolved:** the page falls back to today's unscoped fetch
  (safe — it is an explicit page view, not a notification surface, and non-admins remain
  self-scoped by the backend). With no resolved id there is no badge/unread anyway, so
  no clear-without-showing inconsistency arises.
- **Tab hidden:** existing interval backs off; toasts appear on next foreground poll.
- **On `/tasks` when a task finishes:** a toast may still fire (harmless); `lastSeenAt`
  keeps the badge at zero.

## Testing

- **Vitest** added (minimal config + `"test": "vitest run"` script). Unit tests for
  `filterMine` (drops foreign `submitted_by`), `diffNewlyTerminal` (non-terminal→
  terminal detected; terminal→terminal ignored; non-terminal→non-terminal ignored;
  absent-in-prev ignored; baseline/empty prev), `countUnread` (boundary on `lastSeenAt`,
  failure flag, missing `finished_at` fallback, and `isSaturated`: equals `pageFull`
  (true when `pageFull`, false otherwise — independent of the visible tasks' state), and
  `toastForTransition` (type + message per status).
- Wire `npm test` into `.github/workflows/ci.yml`.
- Static: `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Manual: kick off an import; navigate away; confirm a clickable toast on completion
  and the Tasks badge showing unread (danger tone on failure); visiting `/tasks`
  clears it; reload preserves unread state until `/tasks` is visited.

## Files

- Create: `src/lib/task-notifications.ts`, `src/lib/task-notifications.test.ts`,
  `src/lib/use-current-user-id.ts`, `vitest.config.ts`.
- Modify: `src/components/app-shell.tsx` (poll mine, transitions, badge, lastSeen;
  remove `recentFailureUntil`); `src/app/(protected)/layout.tsx` + `AppShell` props
  (pass `currentUsername`); `src/components/tasks-workspace.tsx` (scope to my tasks via
  `useCurrentUserId` + `filterMine`); `src/app/(protected)/tasks/page.tsx` (pass
  `currentUsername` to `TasksWorkspace`); `src/lib/toast-context.tsx` +
  `src/components/toast-container.tsx` (optional action/href); `package.json` (vitest
  dep + test script); `.github/workflows/ci.yml` (run tests).
