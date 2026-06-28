# Auth adaptation (principals, scoped tokens, service accounts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the Hubuum frontend to PR #94's principal-centric identity model plus PR #95's `/api/v1/iam/me` self-service endpoints — field rename, re-homed IAM endpoints, `/me`-based self-service token/group/permission surfaces, scoped token minting, and service-account management.

**Architecture:** The frontend talks to the backend through a generated fetch client (`src/lib/api/generated/`) whose URLs are rewritten to the BFF prefix `/_hubuum-bff/hubuum`. The client is regenerated from `openapi.json` via `npm run gen:api`. We regenerate first (Part A), fix every breaking call site so the app compiles again (Part B), then layer new features on shared reusable components (Parts C–E).

**Tech Stack:** Next.js 16 (App Router, RSC + client components), React 19, TanStack Query v5, Zod v4, Biome (lint), Vitest (unit tests), orval (client gen).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-28-auth-principals-scoped-tokens-service-accounts-design.md` — every task implicitly serves it.
- Generated code (`src/lib/api/generated/**`) is committed and regenerated only via `npm run gen:api`; never hand-edit it.
- Scope semantics are fail-closed: omit `scopes` ⇒ unscoped; non-empty array ⇒ scoped; **never send `scopes: []`** (backend rejects with 400).
- `UpdateUser` has no `name` field — the principal name is **not** renamable from this UI; name is display-only on profile/admin surfaces.
- Disable for service accounts is **one-way** (no enable endpoint exists).
- Follow existing patterns: TanStack Query for data, `getApiErrorMessage` for error text, `"use client"` components imported by thin RSC `page.tsx` files, generated client called with `{ credentials: "include" }`.
- Branch: `auth-principals-scoped-tokens-service-accounts` (already created). Commit after every task.
- Verification commands: `npm run typecheck`, `npm run lint`, `npm test`.

## Generated client names (produced by Task 1, used by later tasks)

After regen, orval produces these (verified against existing naming convention; Task 1 confirms via grep):

| Function | Returns (`response.data`) |
| --- | --- |
| `getApiV1IamMe(options?)` | `MeResponse` (`{ principal: PrincipalMemberResponse, token: CurrentTokenMetadata }`) |
| `getApiV1IamMeTokens(params?, options?)` | `PrincipalTokenMetadata[]` |
| `getApiV1IamMeGroups(params?, options?)` | `Group[]` |
| `getApiV1IamMePermissions(options?)` | `PrincipalNamespacePermissions[]` |
| `getApiV1IamUsersByUserId(userId, options?)` | `UserResponse` |
| `getApiV1IamPrincipalsByPrincipalIdTokens(principalId, params?, options?)` | `PrincipalTokenMetadata[]` |
| `postApiV1IamPrincipalsByPrincipalIdTokens(principalId, newTokenRequest, options?)` | `{}` at type level; at runtime the parsed body — cast to `PrincipalToken` to read `.token` |
| `postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke(principalId, tokenId, options?)` | success status 200/204 |
| `getApiV1IamPrincipalsByPrincipalIdGroups(principalId, params?, options?)` | `Group[]` |
| `getApiV1IamPrincipalsByPrincipalIdPermissions(principalId, options?)` | `PrincipalNamespacePermissions[]` |
| `getApiV1IamServiceAccounts(params?, options?)` | `ServiceAccountResponse[]` |
| `postApiV1IamServiceAccounts(newServiceAccount, options?)` | `ServiceAccountResponse` |
| `getApiV1IamServiceAccountsByServiceAccountId(serviceAccountId, options?)` | `ServiceAccountResponse` |
| `patchApiV1IamServiceAccountsByServiceAccountId(serviceAccountId, updateServiceAccount, options?)` | `ServiceAccountResponse` |
| `deleteApiV1IamServiceAccountsByServiceAccountId(serviceAccountId, options?)` | success status 204 |
| `postApiV1IamServiceAccountsByServiceAccountIdDisable(serviceAccountId, options?)` | `ServiceAccountResponse` |
| `getApiV1IamGroupsByGroupIdMembers(groupId, params?, options?)` | `PrincipalMemberResponse[]` |
| `postApiV1IamGroupsByGroupIdMembersByPrincipalId(groupId, principalId, options?)` | success status 204 |
| `deleteApiV1IamGroupsByGroupIdMembersByPrincipalId(groupId, principalId, options?)` | success status 204 |

New model types (PascalCase, in `src/lib/api/generated/models`): `MeResponse`, `CurrentTokenMetadata`, `ServiceAccountResponse`, `NewServiceAccount`, `UpdateServiceAccount`, `PrincipalMemberResponse`, `PrincipalToken`, `PrincipalTokenMetadata`, `NewTokenRequest`, `PrincipalNamespacePermissions`, `GroupGrant`, `Permissions` (const-object enum of 29 strings). `UserResponse` gains `name` (replacing `username`) + optional `proper_name`; `NewUser` gains `proper_name`; `UpdateUser` gains `proper_name` and loses `username`.

---

## Part A — Regenerate the client

### Task 1: Regenerate the API client from the new spec

**Files:**
- Modify: `openapi.json` (replace wholesale)
- Modify (generated): `src/lib/api/generated/client.ts`, `src/lib/api/generated/models/**`

**Interfaces:**
- Produces: all generated functions/types in the table above.

- [ ] **Step 1: Replace the spec**

Download the spec from the `me_endpoints` branch (a superset of #94 + #95) to the repo root:

```bash
curl -fsSL "https://raw.githubusercontent.com/hubuum/hubuum/me_endpoints/docs/openapi.json" -o openapi.json
```

- [ ] **Step 2: Verify the spec is the new one**

Run:
```bash
grep -c "service-accounts" openapi.json && grep -c "principals" openapi.json && grep -c "iam/me" openapi.json
```
Expected: all counts > 0 (the last confirms the PR #95 `/me` endpoints are present).

- [ ] **Step 3: Regenerate the client**

Run:
```bash
npm run gen:api
```
Expected: completes without error; new model files appear under `src/lib/api/generated/models/`.

- [ ] **Step 4: Confirm the generated function names**

Run:
```bash
grep -oE "export const (get|post|patch|delete)ApiV1Iam(Principals|ServiceAccounts|Me)[A-Za-z]*" src/lib/api/generated/client.ts | sort -u
grep -oE "export const (post|delete)ApiV1IamGroupsByGroupIdMembersByPrincipalId" src/lib/api/generated/client.ts | sort -u
```
Expected: the names match the table above, including `getApiV1IamMe`, `getApiV1IamMeTokens`, `getApiV1IamMeGroups`, `getApiV1IamMePermissions`. If any differ, note the actual name and use it consistently in later tasks.

- [ ] **Step 5: Confirm field rename and enum**

Run:
```bash
grep -n "proper_name" src/lib/api/generated/models/userResponse.ts
grep -n "name" src/lib/api/generated/models/userResponse.ts | grep -v proper_name
test -f src/lib/api/generated/models/permissions.ts && grep -c "ReadCollection" src/lib/api/generated/models/permissions.ts
test -f src/lib/api/generated/models/meResponse.ts && test -f src/lib/api/generated/models/currentTokenMetadata.ts && echo "me models present"
```
Expected: `userResponse.ts` has `name` and `proper_name` (no `username`); `permissions.ts` exists and contains `ReadCollection`; `meResponse.ts` and `currentTokenMetadata.ts` exist.

- [ ] **Step 6: Commit**

(Typecheck is intentionally red until Part B completes — do not run it here.)
```bash
git add openapi.json src/lib/api/generated
git commit -m "chore: regenerate API client for PR #94 (principals, scoped tokens, service accounts)"
```

---

## Part B — Breaking-change adaptation

> After Task 1 the app does not compile. Each task below fixes a cohesive set of call sites; `npm run typecheck` is expected to remain red until Task 6 (it should report *fewer* errors after each task). Within each task, fix exactly the files listed.

### Task 2: Login flow uses `name`

**Files:**
- Modify: `src/components/login-form.tsx`
- Modify: `src/app/_hubuum-bff/auth/login/route.ts`

**Interfaces:**
- Consumes: `LoginUser` now `{ name: string; password: string }`.

- [ ] **Step 1: Update login-form payload**

In `src/components/login-form.tsx`, change the payload construction. The visible label stays "Username" and the form field name stays `username` (browser autofill), but the JSON body must use `name`.

Replace:
```tsx
			const payload: LoginUser = { username, password };
```
with:
```tsx
			const payload: LoginUser = { name: username, password };
```

- [ ] **Step 2: Update the BFF login route to map the form field to `name`**

In `src/app/_hubuum-bff/auth/login/route.ts`, the Zod schema accepts the posted `username` (from both the JSON client payload and the HTML form) and the route builds a `LoginUser`. Update the schema and the credential construction.

Replace the schema:
```ts
const loginSchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1),
});
```
with one that accepts either `name` or `username` and normalizes to `name`:
```ts
const loginSchema = z
	.object({
		name: z.string().min(1).optional(),
		username: z.string().min(1).optional(),
		password: z.string().min(1),
	})
	.transform((value) => ({
		name: value.name ?? value.username ?? "",
		password: value.password,
	}))
	.refine((value) => value.name.length > 0, {
		message: "name is required",
	});
```

This yields `credentials` of shape `{ name, password }` (a valid `LoginUser`). The existing `createSession(token, credentials.username)` and `setSessionCookie(..., credentials.username)` calls must change to `credentials.name`:

Replace:
```ts
	const sid = await createSession(token, credentials.username);
	const response = fromForm
		? seeOther("/app")
		: NextResponse.json({ authenticated: true }, { status: 200 });
	setSessionCookie(response, sid, request, token, credentials.username);
```
with:
```ts
	const sid = await createSession(token, credentials.name);
	const response = fromForm
		? seeOther("/app")
		: NextResponse.json({ authenticated: true }, { status: 200 });
	setSessionCookie(response, sid, request, token, credentials.name);
```

> Note: the `ParsedCredentials` type alias already says `credentials: LoginUser`; the transformed object satisfies it. The form `formData.get("username")` parsing stays as-is (it feeds the `username` schema field).

- [ ] **Step 3: Lint the two files**

Run:
```bash
npx biome check src/components/login-form.tsx src/app/_hubuum-bff/auth/login/route.ts
```
Expected: no errors (warnings about the broader codebase are out of scope; this checks only these files).

- [ ] **Step 4: Commit**

```bash
git add src/components/login-form.tsx src/app/_hubuum-bff/auth/login/route.ts
git commit -m "feat: log in by principal name"
```

### Task 3: User profile surfaces (account + admin user) use `name`, add `proper_name`

**Files:**
- Modify: `src/components/account-profile.tsx`
- Modify: `src/components/admin-user-detail.tsx`
- Modify: `src/components/admin-users-table.tsx`
- Modify: `src/lib/use-current-user-id.ts`

**Interfaces:**
- Consumes: `UserResponse.name`, `UserResponse.proper_name`; `NewUser { name, password, email?, proper_name? }`; `UpdateUser { email?, password?, proper_name? }`.

- [ ] **Step 1: Rewrite `use-current-user-id.ts` to resolve via `GET /me`**

PR #95 adds `GET /api/v1/iam/me`, so we no longer scan the (admin-only) user list. Replace the **entire** contents of `src/lib/use-current-user-id.ts` with:
```ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiV1IamMe } from "@/lib/api/generated/client";

async function resolveCurrentUserId(): Promise<number | null> {
	const response = await getApiV1IamMe({ credentials: "include" });
	if (response.status !== 200) {
		return null;
	}
	return response.data.principal.principal_id;
}

export function useCurrentUserId(currentUsername: string | null): number | null {
	const query = useQuery({
		queryKey: ["current-user-id", currentUsername],
		queryFn: async () => resolveCurrentUserId(),
		enabled: Boolean(currentUsername),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});

	return query.data ?? null;
}
```

> The `currentUsername` argument is kept (signature unchanged, so `app-shell` and account components don't change) and is used only for the query key + the `enabled` gate; the id itself comes from `/me`.

- [ ] **Step 2: Rework `account-profile.tsx` — load via `/me` + `users/{id}`, name read-only, proper_name editable, no username in UpdateUser**

In `src/components/account-profile.tsx`:

(a) Replace the import block:
```tsx
import {
	getApiV1IamUsers,
	patchApiV1IamUsersByUserId,
} from "@/lib/api/generated/client";
```
with:
```tsx
import {
	getApiV1IamMe,
	getApiV1IamUsersByUserId,
	patchApiV1IamUsersByUserId,
} from "@/lib/api/generated/client";
```
and replace the entire `fetchCurrentUser` function:
```tsx
async function fetchCurrentUser(
	currentUsername: string | null,
): Promise<UserResponse> {
	const response = await getApiV1IamUsers(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load user."));
	}

	const users = response.data;
	const matchedUser = currentUsername
		? users.find((user) => user.username === currentUsername)
		: null;
	const currentUser = matchedUser ?? (users.length === 1 ? users[0] : null);

	if (!currentUser) {
		throw new Error("Current user was not returned by the user endpoint.");
	}

	return currentUser;
}
```
with:
```tsx
async function fetchCurrentUser(): Promise<UserResponse> {
	const meResponse = await getApiV1IamMe({ credentials: "include" });
	if (meResponse.status !== 200) {
		throw new Error(
			getApiErrorMessage(meResponse.data, "Failed to load account."),
		);
	}

	const userId = meResponse.data.principal.principal_id;
	const userResponse = await getApiV1IamUsersByUserId(userId, {
		credentials: "include",
	});
	if (userResponse.status !== 200) {
		throw new Error(
			getApiErrorMessage(userResponse.data, "Failed to load user."),
		);
	}

	return userResponse.data;
}
```
and update the query call (it no longer takes an argument):
```tsx
	const userQuery = useQuery({
		queryKey: ["account-user", currentUsername],
		queryFn: async () => fetchCurrentUser(currentUsername),
	});
```
→
```tsx
	const userQuery = useQuery({
		queryKey: ["account-user", currentUsername],
		queryFn: async () => fetchCurrentUser(),
	});
```

(b) Replace the local state block:
```tsx
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
```
with:
```tsx
	const [properName, setProperName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
```

(c) Replace the init effect body:
```tsx
		setUsername(userQuery.data.username);
		setEmail(userQuery.data.email ?? "");
		setInitializedUserId(userQuery.data.id);
```
with:
```tsx
		setProperName(userQuery.data.proper_name ?? "");
		setEmail(userQuery.data.email ?? "");
		setInitializedUserId(userQuery.data.id);
```

(d) Replace the `onSuccess` reset:
```tsx
			setUsername(updatedUser.username);
			setEmail(updatedUser.email ?? "");
			setPassword("");
```
with:
```tsx
			setProperName(updatedUser.proper_name ?? "");
			setEmail(updatedUser.email ?? "");
			setPassword("");
```

(e) Replace the `onSubmit` payload-building block:
```tsx
		const trimmedUsername = username.trim();
		if (!trimmedUsername) {
			setFormError("Username is required.");
			return;
		}

		const trimmedEmail = email.trim();
		const payload: UpdateUser = {};

		if (trimmedUsername !== originalUser.username) {
			payload.username = trimmedUsername;
		}

		const originalEmail = originalUser.email ?? "";
		if (trimmedEmail !== originalEmail) {
			payload.email = trimmedEmail || null;
		}
```
with:
```tsx
		const trimmedProperName = properName.trim();
		const trimmedEmail = email.trim();
		const payload: UpdateUser = {};

		const originalProperName = originalUser.proper_name ?? "";
		if (trimmedProperName !== originalProperName) {
			payload.proper_name = trimmedProperName || null;
		}

		const originalEmail = originalUser.email ?? "";
		if (trimmedEmail !== originalEmail) {
			payload.email = trimmedEmail || null;
		}
```

(f) Replace the Username input field markup:
```tsx
				<label className="control-field">
					<span>Username</span>
					<input
						required
						value={username}
						onChange={(event) => setUsername(event.target.value)}
					/>
				</label>
```
with a read-only name display plus an editable proper-name field:
```tsx
				<label className="control-field">
					<span>Username</span>
					<input value={user.name} readOnly disabled />
				</label>

				<label className="control-field">
					<span>Display name</span>
					<input
						value={properName}
						onChange={(event) => setProperName(event.target.value)}
						placeholder="e.g. Alice Doe"
					/>
				</label>
```

> `user` is in scope at the JSX (defined as `const user = userQuery.data;` before the return). Leaving `user.name` read-only communicates that renaming isn't supported here.

- [ ] **Step 3: Apply the same rework to `admin-user-detail.tsx`**

In `src/components/admin-user-detail.tsx`, make the analogous changes:

(a) State: replace
```tsx
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
```
with
```tsx
	const [properName, setProperName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
```

(b) Init effect: replace
```tsx
		setUsername(userQuery.data.username);
		setEmail(userQuery.data.email ?? "");
		setInitialized(true);
```
with
```tsx
		setProperName(userQuery.data.proper_name ?? "");
		setEmail(userQuery.data.email ?? "");
		setInitialized(true);
```

(c) `onSuccess`: replace
```tsx
			setUsername(updatedUser.username);
			setEmail(updatedUser.email ?? "");
			setPassword("");
```
with
```tsx
			setProperName(updatedUser.proper_name ?? "");
			setEmail(updatedUser.email ?? "");
			setPassword("");
```

(d) `onSubmit` payload block: replace
```tsx
		const trimmedUsername = username.trim();
		if (!trimmedUsername) {
			setFormError("Username is required.");
			return;
		}

		const trimmedEmail = email.trim();
		const payload: UpdateUser = {};

		if (trimmedUsername !== originalUser.username) {
			payload.username = trimmedUsername;
		}

		const originalEmail = originalUser.email ?? "";
		if (trimmedEmail !== originalEmail) {
			payload.email = trimmedEmail || null;
		}
```
with
```tsx
		const trimmedProperName = properName.trim();
		const trimmedEmail = email.trim();
		const payload: UpdateUser = {};

		const originalProperName = originalUser.proper_name ?? "";
		if (trimmedProperName !== originalProperName) {
			payload.proper_name = trimmedProperName || null;
		}

		const originalEmail = originalUser.email ?? "";
		if (trimmedEmail !== originalEmail) {
			payload.email = trimmedEmail || null;
		}
```

(e) Header: replace `{user.username}` with `{user.name}`:
```tsx
					<h2>
						{user.username} <span className="muted">#{user.id}</span>
					</h2>
```
→
```tsx
					<h2>
						{user.name} <span className="muted">#{user.id}</span>
					</h2>
```

(f) Profile fields markup: replace the Username field
```tsx
					<label className="control-field">
						<span>Username</span>
						<input
							required
							value={username}
							onChange={(event) => setUsername(event.target.value)}
						/>
					</label>
```
with
```tsx
					<label className="control-field">
						<span>Username</span>
						<input value={user.name} readOnly disabled />
					</label>

					<label className="control-field">
						<span>Display name</span>
						<input
							value={properName}
							onChange={(event) => setProperName(event.target.value)}
							placeholder="e.g. Alice Doe"
						/>
					</label>
```

(g) Migrate the groups fetch to the principal endpoint. Replace the import:
```tsx
	getApiV1IamUsersByUserId,
	getApiV1IamUsersByUserIdGroups,
	patchApiV1IamUsersByUserId,
```
with:
```tsx
	getApiV1IamPrincipalsByPrincipalIdGroups,
	getApiV1IamUsersByUserId,
	patchApiV1IamUsersByUserId,
```
and replace the call inside `fetchUserGroups`:
```tsx
	const response = await getApiV1IamUsersByUserIdGroups(userId, undefined, {
		credentials: "include",
	});
```
with:
```tsx
	const response = await getApiV1IamPrincipalsByPrincipalIdGroups(
		userId,
		undefined,
		{ credentials: "include" },
	);
```

- [ ] **Step 4: Update `admin-users-table.tsx` create form to use `name` + `proper_name`**

In `src/components/admin-users-table.tsx`:

(a) State: replace
```tsx
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [email, setEmail] = useState("");
```
with
```tsx
	const [username, setUsername] = useState("");
	const [properName, setProperName] = useState("");
	const [password, setPassword] = useState("");
	const [email, setEmail] = useState("");
```

(b) `onSuccess` reset: add proper-name reset — replace
```tsx
			setUsername("");
			setPassword("");
			setEmail("");
```
with
```tsx
			setUsername("");
			setProperName("");
			setPassword("");
			setEmail("");
```

(c) `onSubmit` payload: replace
```tsx
		const trimmedEmail = email.trim();
		const payload: NewUser = {
			username: trimmedUsername,
			password,
		};

		if (trimmedEmail) {
			payload.email = trimmedEmail;
		}
```
with
```tsx
		const trimmedEmail = email.trim();
		const trimmedProperName = properName.trim();
		const payload: NewUser = {
			name: trimmedUsername,
			password,
		};

		if (trimmedEmail) {
			payload.email = trimmedEmail;
		}

		if (trimmedProperName) {
			payload.proper_name = trimmedProperName;
		}
```

(d) Create form markup: add a Display-name field after the Username field. Replace
```tsx
					<label className="control-field">
						<span>Username</span>
						<input
							required
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							placeholder="e.g. alice"
						/>
					</label>
```
with
```tsx
					<label className="control-field">
						<span>Username</span>
						<input
							required
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							placeholder="e.g. alice"
						/>
					</label>

					<label className="control-field">
						<span>Display name (optional)</span>
						<input
							value={properName}
							onChange={(event) => setProperName(event.target.value)}
							placeholder="e.g. Alice Doe"
						/>
					</label>
```

(e) Table cells: replace `user.username` (the aria-label and the link text and the column will stay labelled "Username" but show `name`). Replace
```tsx
										aria-label={`Select user ${user.username}`}
```
with
```tsx
										aria-label={`Select user ${user.name}`}
```
and replace
```tsx
									<Link className="row-link" href={`/admin/users/${user.id}`}>
										{user.username}
									</Link>
```
with
```tsx
									<Link className="row-link" href={`/admin/users/${user.id}`}>
										{user.name}
									</Link>
```

- [ ] **Step 5: Lint these files**

Run:
```bash
npx biome check src/components/account-profile.tsx src/components/admin-user-detail.tsx src/components/admin-users-table.tsx src/lib/use-current-user-id.ts
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/account-profile.tsx src/components/admin-user-detail.tsx src/components/admin-users-table.tsx src/lib/use-current-user-id.ts
git commit -m "feat: adopt principal name and proper_name on user surfaces"
```

### Task 4: Group detail uses principal members

**Files:**
- Modify: `src/components/admin-group-detail.tsx`

**Interfaces:**
- Consumes: `getApiV1IamGroupsByGroupIdMembers → PrincipalMemberResponse[]` (`{ principal_id, kind, name }`); `post/deleteApiV1IamGroupsByGroupIdMembersByPrincipalId(groupId, principalId, options)`; `UserResponse.name`.

- [ ] **Step 1: Update imports**

In `src/components/admin-group-detail.tsx`, replace:
```tsx
	deleteApiV1IamGroupsByGroupIdMembersByUserId,
	getApiV1IamGroupsByGroupId,
	getApiV1IamGroupsByGroupIdMembers,
	getApiV1IamUsers,
	postApiV1IamGroupsByGroupIdMembersByUserId,
} from "@/lib/api/generated/client";
import type { Group, UserResponse } from "@/lib/api/generated/models";
```
with:
```tsx
	deleteApiV1IamGroupsByGroupIdMembersByPrincipalId,
	getApiV1IamGroupsByGroupId,
	getApiV1IamGroupsByGroupIdMembers,
	getApiV1IamUsers,
	postApiV1IamGroupsByGroupIdMembersByPrincipalId,
} from "@/lib/api/generated/client";
import type {
	Group,
	PrincipalMemberResponse,
	UserResponse,
} from "@/lib/api/generated/models";
```

- [ ] **Step 2: Retype `fetchGroupMembers`**

Replace:
```tsx
async function fetchGroupMembers(groupId: number): Promise<UserResponse[]> {
	const response = await getApiV1IamGroupsByGroupIdMembers(groupId, undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load group members."),
		);
	}

	return response.data;
}
```
with:
```tsx
async function fetchGroupMembers(
	groupId: number,
): Promise<PrincipalMemberResponse[]> {
	const response = await getApiV1IamGroupsByGroupIdMembers(groupId, undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load group members."),
		);
	}

	return response.data;
}
```

- [ ] **Step 3: Fix `formatUserOption` and `resolveUserFromInput` to use `name`**

Replace:
```tsx
function formatUserOption(user: UserResponse): string {
	return `${user.username} (#${user.id})${user.email ? ` - ${user.email}` : ""}`;
}
```
with:
```tsx
function formatUserOption(user: UserResponse): string {
	return `${user.name} (#${user.id})${user.email ? ` - ${user.email}` : ""}`;
}
```
and inside `resolveUserFromInput`, replace:
```tsx
	const matchedByUsername = availableUsers.find(
		(user) => user.username.toLowerCase() === normalized,
	);
```
with:
```tsx
	const matchedByUsername = availableUsers.find(
		(user) => user.name.toLowerCase() === normalized,
	);
```

- [ ] **Step 4: Update membership math to use `principal_id`**

`members` is now `PrincipalMemberResponse[]` keyed by `principal_id`. Replace:
```tsx
	const memberIdSet = useMemo(
		() => new Set(members.map((member) => member.id)),
		[members],
	);
```
with:
```tsx
	const memberIdSet = useMemo(
		() => new Set(members.map((member) => member.principal_id)),
		[members],
	);
```

In the member-suggestions filter, replace:
```tsx
						user.username.toLowerCase().includes(memberInputTerm) ||
```
with:
```tsx
						user.name.toLowerCase().includes(memberInputTerm) ||
```

- [ ] **Step 5: Update add/remove mutations to call the principal endpoints**

Replace the add mutation's call:
```tsx
			const response = await postApiV1IamGroupsByGroupIdMembersByUserId(
				groupId,
				userId,
				{
					credentials: "include",
				},
			);
```
with:
```tsx
			const response = await postApiV1IamGroupsByGroupIdMembersByPrincipalId(
				groupId,
				userId,
				{
					credentials: "include",
				},
			);
```

Replace the remove mutation's call:
```tsx
					const response = await deleteApiV1IamGroupsByGroupIdMembersByUserId(
						groupId,
						userId,
						{
							credentials: "include",
						},
					);
```
with:
```tsx
					const response =
						await deleteApiV1IamGroupsByGroupIdMembersByPrincipalId(
							groupId,
							userId,
							{
								credentials: "include",
							},
						);
```

- [ ] **Step 6: Fix the stale-selection effect and member table to use `principal_id` + show kind**

Replace the stale-selection effect:
```tsx
		const existingIds = new Set(members.map((member) => member.id));
		setSelectedMemberIds((current) =>
			current.filter((memberId) => existingIds.has(memberId)),
		);
```
with:
```tsx
		const existingIds = new Set(members.map((member) => member.principal_id));
		setSelectedMemberIds((current) =>
			current.filter((memberId) => existingIds.has(memberId)),
		);
```

Replace `toggleAllMembers`'s select-all:
```tsx
		if (checked) {
			setSelectedMemberIds(members.map((member) => member.id));
			return;
		}
```
with:
```tsx
		if (checked) {
			setSelectedMemberIds(members.map((member) => member.principal_id));
			return;
		}
```

Replace the member table header and rows. Find:
```tsx
								<tr>
									<th className="check-col">
										<input
											type="checkbox"
											aria-label="Select all members"
											checked={allMembersSelected}
											onChange={(event) =>
												toggleAllMembers(event.target.checked)
											}
										/>
									</th>
									<th>ID</th>
									<th>Username</th>
									<th>Email</th>
								</tr>
							</thead>
							<tbody>
								{members.map((member) => (
									<tr key={member.id}>
										<td className="check-col">
											<input
												type="checkbox"
												aria-label={`Select member ${member.username}`}
												checked={selectedMemberIds.includes(member.id)}
												onChange={(event) =>
													toggleMember(member.id, event.target.checked)
												}
												disabled={isMembershipUpdating}
											/>
										</td>
										<td>{member.id}</td>
										<td>{member.username}</td>
										<td>{member.email ?? "-"}</td>
									</tr>
								))}
							</tbody>
```
Replace with:
```tsx
								<tr>
									<th className="check-col">
										<input
											type="checkbox"
											aria-label="Select all members"
											checked={allMembersSelected}
											onChange={(event) =>
												toggleAllMembers(event.target.checked)
											}
										/>
									</th>
									<th>ID</th>
									<th>Name</th>
									<th>Kind</th>
								</tr>
							</thead>
							<tbody>
								{members.map((member) => (
									<tr key={member.principal_id}>
										<td className="check-col">
											<input
												type="checkbox"
												aria-label={`Select member ${member.name}`}
												checked={selectedMemberIds.includes(
													member.principal_id,
												)}
												onChange={(event) =>
													toggleMember(
														member.principal_id,
														event.target.checked,
													)
												}
												disabled={isMembershipUpdating}
											/>
										</td>
										<td>{member.principal_id}</td>
										<td>{member.name}</td>
										<td>
											<span className="badge">
												{member.kind === "service_account"
													? "Service account"
													: "Human"}
											</span>
										</td>
									</tr>
								))}
							</tbody>
```

> `toggleMember(userId, checked)` keeps its signature (it takes a numeric id); we now pass `member.principal_id`. No change needed to the function body.

- [ ] **Step 7: Lint**

Run:
```bash
npx biome check src/components/admin-group-detail.tsx
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin-group-detail.tsx
git commit -m "feat: render group members as principals (human + service account)"
```

### Task 5: Remaining readers — namespace/object current-user groups, task submitter

**Files:**
- Modify: `src/components/namespace-detail.tsx`
- Modify: `src/components/object-detail.tsx`
- Modify: `src/components/task-detail.tsx`

**Interfaces:**
- Consumes: `getApiV1IamMeGroups` (→ `Group[]`), `UserResponse.name`.

- [ ] **Step 1: namespace-detail `fetchCurrentUserGroups` → `/me/groups`**

In `src/components/namespace-detail.tsx`, update the import list: remove `getApiV1IamUsers` and `getApiV1IamUsersByUserIdGroups` from the generated-client import **only if they are not used elsewhere in the file** (grep first: `grep -n "getApiV1IamUsers\b\|getApiV1IamUsersByUserIdGroups" src/components/namespace-detail.tsx`); add `getApiV1IamMeGroups`. Then replace the entire `fetchCurrentUserGroups` function:
```tsx
async function fetchCurrentUserGroups(username: string): Promise<Group[]> {
	try {
		const usersResponse = await getApiV1IamUsers(undefined, {
			credentials: "include",
		});
		if (usersResponse.status !== 200) {
			return [];
		}

		const matchedUser = usersResponse.data.find(
			(user) => user.username === username,
		);
		if (!matchedUser) {
			return [];
		}

		const userGroupsResponse = await getApiV1IamUsersByUserIdGroups(
			matchedUser.id,
			undefined,
			{
				credentials: "include",
			},
		);
		if (userGroupsResponse.status !== 200) {
			return [];
		}

		return userGroupsResponse.data;
	} catch {
		return [];
	}
}
```
with:
```tsx
async function fetchCurrentUserGroups(_username: string): Promise<Group[]> {
	try {
		const response = await getApiV1IamMeGroups(undefined, {
			credentials: "include",
		});
		if (response.status !== 200) {
			return [];
		}
		return response.data;
	} catch {
		return [];
	}
}
```

> The `_username` parameter is retained (prefixed to satisfy lint) so the call site is unchanged. If the grep in the import step shows `getApiV1IamUsers` is still used elsewhere, keep that import and only remove `getApiV1IamUsersByUserIdGroups`.

- [ ] **Step 2: object-detail `fetchCurrentUserGroups` → `/me/groups`**

Apply the identical import swap and the identical function replacement in `src/components/object-detail.tsx` (the function is byte-identical to namespace-detail's). Run the same grep there first to decide whether `getApiV1IamUsers` must stay.

- [ ] **Step 3: task-detail submitter**

In `src/components/task-detail.tsx`, replace:
```tsx
async function fetchTaskSubmitter(
	userId: number,
): Promise<{ id: number; username: string } | null> {
	const response = await getApiV1IamUsersByUserId(userId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		return null;
	}

	return {
		id: response.data.id,
		username: response.data.username,
	};
}
```
with:
```tsx
async function fetchTaskSubmitter(
	userId: number,
): Promise<{ id: number; name: string } | null> {
	const response = await getApiV1IamUsersByUserId(userId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		return null;
	}

	return {
		id: response.data.id,
		name: response.data.name,
	};
}
```
and replace the label line:
```tsx
			submittedByLabel = `${submitterQuery.data.username} (#${submitterQuery.data.id})`;
```
with:
```tsx
			submittedByLabel = `${submitterQuery.data.name} (#${submitterQuery.data.id})`;
```

- [ ] **Step 4: Lint**

Run:
```bash
npx biome check src/components/namespace-detail.tsx src/components/object-detail.tsx src/components/task-detail.tsx
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/namespace-detail.tsx src/components/object-detail.tsx src/components/task-detail.tsx
git commit -m "feat: resolve current-user groups and task submitter via principal name"
```

### Task 6: Part B verification gate — app compiles again

**Files:** none (verification only; fix any stragglers the checks surface).

- [ ] **Step 1: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS (no errors). If errors remain, they will name a file + symbol still referencing `username` or a removed `…ByUserId…` token/group/member function — fix it the same way the tasks above did (`username`→`name`, user→principal endpoint), then re-run.

- [ ] **Step 2: Lint + existing tests**

Run:
```bash
npm run lint && npm test
```
Expected: lint clean; all existing tests pass.

- [ ] **Step 3: Commit (only if Step 1 required straggler fixes)**

```bash
git add -A
git commit -m "fix: complete principal rename adaptation"
```

---

## Part C — Token scopes utility (shared)

### Task 7: `lib/token-scopes.ts` — grouped permission catalog

**Files:**
- Create: `src/lib/token-scopes.ts`
- Test: `src/lib/token-scopes.test.ts`

**Interfaces:**
- Produces: `SCOPE_GROUPS: ScopeGroup[]` where `ScopeGroup = { label: string; scopes: Permissions[] }`; `ALL_SCOPES: Permissions[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/token-scopes.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { Permissions } from "@/lib/api/generated/models";
import { ALL_SCOPES, SCOPE_GROUPS } from "@/lib/token-scopes";

describe("token-scopes", () => {
	it("covers every Permissions value exactly once", () => {
		const grouped = SCOPE_GROUPS.flatMap((group) => group.scopes).sort();
		const all = Object.values(Permissions).sort();
		expect(grouped).toEqual(all);
	});

	it("exposes the flat list matching the enum", () => {
		expect([...ALL_SCOPES].sort()).toEqual(Object.values(Permissions).sort());
	});

	it("has no empty groups", () => {
		for (const group of SCOPE_GROUPS) {
			expect(group.scopes.length).toBeGreaterThan(0);
		}
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/lib/token-scopes.test.ts
```
Expected: FAIL — cannot resolve `@/lib/token-scopes`.

- [ ] **Step 3: Implement the catalog**

Create `src/lib/token-scopes.ts`:
```ts
import { Permissions } from "@/lib/api/generated/models";

export type ScopeGroup = {
	label: string;
	scopes: Permissions[];
};

export const SCOPE_GROUPS: ScopeGroup[] = [
	{
		label: "Collections (namespaces)",
		scopes: [
			Permissions.ReadCollection,
			Permissions.UpdateCollection,
			Permissions.DeleteCollection,
			Permissions.DelegateCollection,
		],
	},
	{
		label: "Classes",
		scopes: [
			Permissions.CreateClass,
			Permissions.ReadClass,
			Permissions.UpdateClass,
			Permissions.DeleteClass,
		],
	},
	{
		label: "Objects",
		scopes: [
			Permissions.CreateObject,
			Permissions.ReadObject,
			Permissions.UpdateObject,
			Permissions.DeleteObject,
		],
	},
	{
		label: "Class relations",
		scopes: [
			Permissions.CreateClassRelation,
			Permissions.ReadClassRelation,
			Permissions.UpdateClassRelation,
			Permissions.DeleteClassRelation,
		],
	},
	{
		label: "Object relations",
		scopes: [
			Permissions.CreateObjectRelation,
			Permissions.ReadObjectRelation,
			Permissions.UpdateObjectRelation,
			Permissions.DeleteObjectRelation,
		],
	},
	{
		label: "Templates",
		scopes: [
			Permissions.CreateTemplate,
			Permissions.ReadTemplate,
			Permissions.UpdateTemplate,
			Permissions.DeleteTemplate,
		],
	},
	{
		label: "Remote targets",
		scopes: [
			Permissions.CreateRemoteTarget,
			Permissions.ReadRemoteTarget,
			Permissions.UpdateRemoteTarget,
			Permissions.DeleteRemoteTarget,
			Permissions.ExecuteRemoteTarget,
		],
	},
];

export const ALL_SCOPES: Permissions[] = SCOPE_GROUPS.flatMap(
	(group) => group.scopes,
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/lib/token-scopes.test.ts
```
Expected: PASS. If the coverage test fails, the generated enum changed — reconcile `SCOPE_GROUPS` against `Object.values(Permissions)` (add the missing value to the right group).

- [ ] **Step 5: Commit**

```bash
git add src/lib/token-scopes.ts src/lib/token-scopes.test.ts
git commit -m "feat: add grouped token-scope catalog"
```

### Task 8: `ScopePicker` component + pure payload helper

**Files:**
- Create: `src/lib/token-scope-selection.ts`
- Test: `src/lib/token-scope-selection.test.ts`
- Create: `src/components/scope-picker.tsx`

**Interfaces:**
- Produces: `toScopesPayload(restrict: boolean, selected: Permissions[]): Permissions[] | undefined`; `canSubmitScopes(restrict: boolean, selected: Permissions[]): boolean`. `ScopePicker` props `{ restrict, selected, onChange }` where `onChange(restrict: boolean, selected: Permissions[])`.

- [ ] **Step 1: Write the failing test for the payload helper**

Create `src/lib/token-scope-selection.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { Permissions } from "@/lib/api/generated/models";
import {
	canSubmitScopes,
	toScopesPayload,
} from "@/lib/token-scope-selection";

describe("token-scope-selection", () => {
	it("returns undefined (unscoped) when restriction is off", () => {
		expect(toScopesPayload(false, [Permissions.ReadObject])).toBeUndefined();
	});

	it("returns the selected scopes when restriction is on", () => {
		expect(toScopesPayload(true, [Permissions.ReadObject])).toEqual([
			Permissions.ReadObject,
		]);
	});

	it("never yields an empty array (returns undefined instead)", () => {
		expect(toScopesPayload(true, [])).toBeUndefined();
	});

	it("blocks submit when restricting with no scopes selected", () => {
		expect(canSubmitScopes(true, [])).toBe(false);
	});

	it("allows submit when unrestricted", () => {
		expect(canSubmitScopes(false, [])).toBe(true);
	});

	it("allows submit when restricting with at least one scope", () => {
		expect(canSubmitScopes(true, [Permissions.ReadObject])).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/lib/token-scope-selection.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/token-scope-selection.ts`:
```ts
import type { Permissions } from "@/lib/api/generated/models";

/**
 * Maps the picker state to the API `scopes` field. Fail-closed semantics:
 * unrestricted => omit (unscoped); restricted with selections => the array;
 * restricted with no selections => undefined (we never send `[]`, which the
 * backend rejects with 400).
 */
export function toScopesPayload(
	restrict: boolean,
	selected: Permissions[],
): Permissions[] | undefined {
	if (!restrict || selected.length === 0) {
		return undefined;
	}

	return selected;
}

export function canSubmitScopes(
	restrict: boolean,
	selected: Permissions[],
): boolean {
	if (!restrict) {
		return true;
	}

	return selected.length > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/lib/token-scope-selection.test.ts
```
Expected: PASS.

- [ ] **Step 5: Implement the `ScopePicker` UI component**

Create `src/components/scope-picker.tsx`:
```tsx
"use client";

import type { Permissions } from "@/lib/api/generated/models";
import { SCOPE_GROUPS } from "@/lib/token-scopes";

type ScopePickerProps = {
	restrict: boolean;
	selected: Permissions[];
	disabled?: boolean;
	onChange: (restrict: boolean, selected: Permissions[]) => void;
};

export function ScopePicker({
	restrict,
	selected,
	disabled,
	onChange,
}: ScopePickerProps) {
	const selectedSet = new Set(selected);

	function toggleScope(scope: Permissions, checked: boolean) {
		const next = new Set(selectedSet);
		if (checked) {
			next.add(scope);
		} else {
			next.delete(scope);
		}
		onChange(restrict, [...next]);
	}

	return (
		<div className="stack">
			<label className="control-field">
				<span>Scopes</span>
				<label className="checkbox-row">
					<input
						type="checkbox"
						checked={restrict}
						disabled={disabled}
						onChange={(event) => onChange(event.target.checked, selected)}
					/>
					<span>Restrict this token to specific permissions</span>
				</label>
			</label>

			{restrict ? (
				<div className="scope-grid">
					{SCOPE_GROUPS.map((group) => (
						<fieldset key={group.label} className="scope-group">
							<legend>{group.label}</legend>
							{group.scopes.map((scope) => (
								<label key={scope} className="checkbox-row">
									<input
										type="checkbox"
										checked={selectedSet.has(scope)}
										disabled={disabled}
										onChange={(event) =>
											toggleScope(scope, event.target.checked)
										}
									/>
									<span>{scope}</span>
								</label>
							))}
						</fieldset>
					))}
				</div>
			) : (
				<p className="muted">
					Unscoped — this token carries the principal&apos;s full authority.
				</p>
			)}
		</div>
	);
}
```

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
npx biome check src/lib/token-scope-selection.ts src/components/scope-picker.tsx && npm run typecheck
```
Expected: clean; typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/token-scope-selection.ts src/lib/token-scope-selection.test.ts src/components/scope-picker.tsx
git commit -m "feat: add scope picker with fail-closed payload helper"
```

### Task 9: Token management components (`TokenMintForm`, `TokenList`, `RawTokenReveal`)

**Files:**
- Create: `src/components/raw-token-reveal.tsx`
- Create: `src/components/token-mint-form.tsx`
- Create: `src/components/token-list.tsx`

**Interfaces:**
- Consumes: `getApiV1IamPrincipalsByPrincipalIdTokens`, `postApiV1IamPrincipalsByPrincipalIdTokens`, `postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke`; types `PrincipalToken`, `PrincipalTokenMetadata`, `NewTokenRequest`, `Permissions`; `toScopesPayload`, `canSubmitScopes`; `ScopePicker`.
- Produces: `<RawTokenReveal token={string} onDismiss={() => void} />`, `<TokenMintForm principalId={number} onMinted={(t: PrincipalToken) => void} />`, `<TokenList principalId={number} />`.

- [ ] **Step 1: `RawTokenReveal`**

Create `src/components/raw-token-reveal.tsx`:
```tsx
"use client";

import { useState } from "react";

type RawTokenRevealProps = {
	token: string;
	onDismiss: () => void;
};

export function RawTokenReveal({ token, onDismiss }: RawTokenRevealProps) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div className="card stack token-reveal">
			<h4>Token created</h4>
			<p className="warning-banner">
				Copy this token now — it is shown only once and cannot be retrieved
				again.
			</p>
			<code className="token-value">{token}</code>
			<div className="form-actions">
				<button type="button" onClick={copy}>
					{copied ? "Copied" : "Copy token"}
				</button>
				<button type="button" className="ghost" onClick={onDismiss}>
					Done
				</button>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: `TokenMintForm`**

Create `src/components/token-mint-form.tsx`:
```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";

import { ScopePicker } from "@/components/scope-picker";
import { getApiErrorMessage } from "@/lib/api/errors";
import { postApiV1IamPrincipalsByPrincipalIdTokens } from "@/lib/api/generated/client";
import type {
	NewTokenRequest,
	Permissions,
	PrincipalToken,
} from "@/lib/api/generated/models";
import {
	canSubmitScopes,
	toScopesPayload,
} from "@/lib/token-scope-selection";

type TokenMintFormProps = {
	principalId: number;
	onMinted: (token: PrincipalToken) => void;
};

export function TokenMintForm({ principalId, onMinted }: TokenMintFormProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [expiresAt, setExpiresAt] = useState("");
	const [restrict, setRestrict] = useState(false);
	const [selected, setSelected] = useState<Permissions[]>([]);
	const [formError, setFormError] = useState<string | null>(null);

	const mintMutation = useMutation({
		mutationFn: async (payload: NewTokenRequest) => {
			const response = await postApiV1IamPrincipalsByPrincipalIdTokens(
				principalId,
				payload,
				{ credentials: "include" },
			);

			if (response.status !== 201 && response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to create token."),
				);
			}

			// The 201 body is the raw token (not modeled in OpenAPI); the runtime
			// client parses it into `data`.
			return response.data as unknown as PrincipalToken;
		},
		onSuccess: async (token) => {
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", principalId],
			});
			setName("");
			setDescription("");
			setExpiresAt("");
			setRestrict(false);
			setSelected([]);
			setFormError(null);
			onMinted(token);
		},
		onError: (error) => {
			setFormError(
				error instanceof Error ? error.message : "Failed to create token.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);

		if (!canSubmitScopes(restrict, selected)) {
			setFormError("Select at least one scope, or turn off scope restriction.");
			return;
		}

		const payload: NewTokenRequest = {};
		const trimmedName = name.trim();
		const trimmedDescription = description.trim();
		if (trimmedName) {
			payload.name = trimmedName;
		}
		if (trimmedDescription) {
			payload.description = trimmedDescription;
		}
		if (expiresAt) {
			payload.expires_at = new Date(expiresAt).toISOString();
		}
		const scopes = toScopesPayload(restrict, selected);
		if (scopes) {
			payload.scopes = scopes;
		}

		mintMutation.mutate(payload);
	}

	return (
		<form className="card stack" onSubmit={onSubmit}>
			<h3>Create token</h3>

			<div className="form-grid">
				<label className="control-field">
					<span>Name (optional)</span>
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. ci-pipeline"
					/>
				</label>

				<label className="control-field">
					<span>Expires (optional)</span>
					<input
						type="datetime-local"
						value={expiresAt}
						onChange={(event) => setExpiresAt(event.target.value)}
					/>
				</label>

				<label className="control-field control-field--wide">
					<span>Description (optional)</span>
					<input
						value={description}
						onChange={(event) => setDescription(event.target.value)}
					/>
				</label>
			</div>

			<ScopePicker
				restrict={restrict}
				selected={selected}
				disabled={mintMutation.isPending}
				onChange={(nextRestrict, nextSelected) => {
					setRestrict(nextRestrict);
					setSelected(nextSelected);
				}}
			/>

			{formError ? <div className="error-banner">{formError}</div> : null}

			<div className="form-actions">
				<button type="submit" disabled={mintMutation.isPending}>
					{mintMutation.isPending ? "Creating..." : "Create token"}
				</button>
			</div>
		</form>
	);
}
```

- [ ] **Step 3: `TokenList`**

Create `src/components/token-list.tsx`. The `principalId` prop is `number | "me"`: when `"me"` it lists via `getApiV1IamMeTokens` (PR #95). Revocation always targets `token.principal_id` from the row (present on every `PrincipalTokenMetadata`), so the same code path serves both self and service accounts.
```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMeTokens,
	getApiV1IamPrincipalsByPrincipalIdTokens,
	postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke,
} from "@/lib/api/generated/client";
import type { PrincipalTokenMetadata } from "@/lib/api/generated/models";

type TokenListProps = {
	principalId: number | "me";
};

async function fetchTokens(
	principalId: number | "me",
): Promise<PrincipalTokenMetadata[]> {
	const response =
		principalId === "me"
			? await getApiV1IamMeTokens(undefined, { credentials: "include" })
			: await getApiV1IamPrincipalsByPrincipalIdTokens(principalId, undefined, {
					credentials: "include",
				});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load tokens."));
	}

	return response.data;
}

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "—";
	}
	return new Date(value).toLocaleString();
}

export function TokenList({ principalId }: TokenListProps) {
	const queryClient = useQueryClient();

	const tokensQuery = useQuery({
		queryKey: ["principal-tokens", principalId],
		queryFn: async () => fetchTokens(principalId),
	});

	const revokeMutation = useMutation({
		mutationFn: async (token: PrincipalTokenMetadata) => {
			const response =
				await postApiV1IamPrincipalsByPrincipalIdTokensByTokenIdRevoke(
					token.principal_id,
					token.id,
					{ credentials: "include" },
				);

			if (response.status !== 200 && response.status !== 204) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to revoke token."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", principalId],
			});
		},
	});

	function revoke(token: PrincipalTokenMetadata) {
		if (!window.confirm(`Revoke token #${token.id}? This cannot be undone.`)) {
			return;
		}
		revokeMutation.mutate(token);
	}

	if (tokensQuery.isLoading) {
		return <div className="card">Loading tokens...</div>;
	}

	if (tokensQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load tokens.{" "}
				{tokensQuery.error instanceof Error
					? tokensQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const tokens = tokensQuery.data ?? [];

	return (
		<section className="card stack">
			<h3>Tokens ({tokens.length})</h3>

			{revokeMutation.isError ? (
				<div className="error-banner">
					{revokeMutation.error instanceof Error
						? revokeMutation.error.message
						: "Failed to revoke token."}
				</div>
			) : null}

			{tokens.length === 0 ? (
				<div className="muted">No tokens.</div>
			) : (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>Name</th>
								<th>Scoped</th>
								<th>Issued</th>
								<th>Expires</th>
								<th>Last used</th>
								<th>Status</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{tokens.map((token) => {
								const revoked = Boolean(token.revoked_at);
								return (
									<tr key={token.id}>
										<td>{token.id}</td>
										<td>{token.name ?? "—"}</td>
										<td>{token.scoped ? "Scoped" : "Unscoped"}</td>
										<td>{formatTimestamp(token.issued)}</td>
										<td>{formatTimestamp(token.expires_at)}</td>
										<td>{formatTimestamp(token.last_used_at)}</td>
										<td>{revoked ? "Revoked" : "Active"}</td>
										<td>
											<button
												type="button"
												className="danger"
												onClick={() => revoke(token)}
												disabled={revoked || revokeMutation.isPending}
											>
												Revoke
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
```

- [ ] **Step 4: Typecheck + lint**

Run:
```bash
npx biome check src/components/raw-token-reveal.tsx src/components/token-mint-form.tsx src/components/token-list.tsx && npm run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/raw-token-reveal.tsx src/components/token-mint-form.tsx src/components/token-list.tsx
git commit -m "feat: add reusable token mint/list/reveal components"
```

### Task 10: `PrincipalPermissions` component

**Files:**
- Create: `src/components/principal-permissions.tsx`

**Interfaces:**
- Consumes: `getApiV1IamPrincipalsByPrincipalIdPermissions → PrincipalNamespacePermissions[]` (`{ namespace_id, namespace_name, grants: GroupGrant[] }`, `GroupGrant = { group_id, groupname, permissions: Permissions[] }`).
- Produces: `<PrincipalPermissions principalId={number} />`.

- [ ] **Step 1: Implement the component**

Create `src/components/principal-permissions.tsx`. The `principalId` prop is `number | "me"`: when `"me"` it reads `/me/permissions` (PR #95).
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMePermissions,
	getApiV1IamPrincipalsByPrincipalIdPermissions,
} from "@/lib/api/generated/client";
import type { PrincipalNamespacePermissions } from "@/lib/api/generated/models";

type PrincipalPermissionsProps = {
	principalId: number | "me";
};

async function fetchPermissions(
	principalId: number | "me",
): Promise<PrincipalNamespacePermissions[]> {
	const response =
		principalId === "me"
			? await getApiV1IamMePermissions({ credentials: "include" })
			: await getApiV1IamPrincipalsByPrincipalIdPermissions(principalId, {
					credentials: "include",
				});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load permissions."),
		);
	}

	return response.data;
}

export function PrincipalPermissions({
	principalId,
}: PrincipalPermissionsProps) {
	const permissionsQuery = useQuery({
		queryKey: ["principal-permissions", principalId],
		queryFn: async () => fetchPermissions(principalId),
	});

	if (permissionsQuery.isLoading) {
		return <div className="card">Loading permissions...</div>;
	}

	if (permissionsQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load permissions.{" "}
				{permissionsQuery.error instanceof Error
					? permissionsQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const namespaces = permissionsQuery.data ?? [];

	if (namespaces.length === 0) {
		return (
			<div className="card muted">
				No effective permissions on any namespace.
			</div>
		);
	}

	return (
		<section className="stack">
			{namespaces.map((namespace) => (
				<div key={namespace.namespace_id} className="card stack">
					<h4>
						{namespace.namespace_name}{" "}
						<span className="muted">#{namespace.namespace_id}</span>
					</h4>
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Granted by group</th>
									<th>Permissions</th>
								</tr>
							</thead>
							<tbody>
								{namespace.grants.map((grant) => (
									<tr key={grant.group_id}>
										<td>
											{grant.groupname}{" "}
											<span className="muted">#{grant.group_id}</span>
										</td>
										<td>
											<div className="chip-row">
												{grant.permissions.map((permission) => (
													<span key={permission} className="badge">
														{permission}
													</span>
												))}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			))}
		</section>
	);
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npx biome check src/components/principal-permissions.tsx && npm run typecheck
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/principal-permissions.tsx
git commit -m "feat: add principal effective-permissions view"
```

---

## Part D — Self-service account routes

### Task 11: Account sub-pages and tabbed nav

**Files:**
- Create: `src/components/account-tabs.tsx`
- Create: `src/components/account-tokens.tsx`
- Create: `src/components/account-groups.tsx`
- Create: `src/app/(protected)/account/tokens/page.tsx`
- Create: `src/app/(protected)/account/groups/page.tsx`
- Create: `src/app/(protected)/account/permissions/page.tsx`
- Modify: `src/app/(protected)/account/page.tsx`

**Interfaces:**
- Consumes: `useCurrentUserId` (for the mint form's numeric id), `TokenList` (with `principalId="me"`), `TokenMintForm`, `RawTokenReveal`, `PrincipalPermissions` (with `principalId="me"`), `getApiV1IamMeGroups`, `requireServerSession`.

- [ ] **Step 1: Account tab strip**

Create `src/components/account-tabs.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
	{ href: "/account", label: "Profile" },
	{ href: "/account/tokens", label: "Tokens" },
	{ href: "/account/groups", label: "Groups" },
	{ href: "/account/permissions", label: "Permissions" },
];

export function AccountTabs() {
	const pathname = usePathname();

	return (
		<nav className="tab-strip" aria-label="Account sections">
			{TABS.map((tab) => {
				const active =
					tab.href === "/account"
						? pathname === "/account"
						: pathname === tab.href || pathname.startsWith(`${tab.href}/`);
				return (
					<Link
						key={tab.href}
						href={tab.href}
						className={active ? "tab tab--active" : "tab"}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}
```

- [ ] **Step 2: Account tokens client component (resolves own principal id, wires mint+list+reveal)**

Create `src/components/account-tokens.tsx`:
```tsx
"use client";

import { useState } from "react";

import { RawTokenReveal } from "@/components/raw-token-reveal";
import { TokenList } from "@/components/token-list";
import { TokenMintForm } from "@/components/token-mint-form";
import { useCurrentUserId } from "@/lib/use-current-user-id";

type AccountTokensProps = {
	currentUsername: string | null;
};

export function AccountTokens({ currentUsername }: AccountTokensProps) {
	const principalId = useCurrentUserId(currentUsername);
	const [rawToken, setRawToken] = useState<string | null>(null);

	if (principalId == null) {
		return (
			<div className="card muted">Resolving your account…</div>
		);
	}

	return (
		<div className="stack">
			{rawToken ? (
				<RawTokenReveal token={rawToken} onDismiss={() => setRawToken(null)} />
			) : null}
			<TokenMintForm
				principalId={principalId}
				onMinted={(token) => setRawToken(token.token)}
			/>
			<TokenList principalId="me" />
		</div>
	);
}
```

> `TokenMintForm` needs the numeric id (mint is `principals/{id}/tokens` — there is no `POST /me/tokens`), so we keep `useCurrentUserId` here. The list uses the `/me/tokens` endpoint via `principalId="me"`.

- [ ] **Step 3: Tokens page (RSC wrapper)**

Create `src/app/(protected)/account/tokens/page.tsx`:
```tsx
import { AccountTabs } from "@/components/account-tabs";
import { AccountTokens } from "@/components/account-tokens";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountTokensPage() {
	const session = await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Tokens</h2>
				<p className="muted">
					Create and revoke API tokens for your own account.
				</p>
			</header>
			<AccountTabs />
			<AccountTokens currentUsername={session.username ?? null} />
		</section>
	);
}
```

- [ ] **Step 4: Groups page — reuse a small client wrapper around the principal-groups query**

Create `src/app/(protected)/account/groups/page.tsx`:
```tsx
import { AccountGroups } from "@/components/account-groups";
import { AccountTabs } from "@/components/account-tabs";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountGroupsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Groups</h2>
				<p className="muted">Groups you belong to.</p>
			</header>
			<AccountTabs />
			<AccountGroups />
		</section>
	);
}
```

Create `src/components/account-groups.tsx` (uses `/me/groups`, so no id resolution needed):
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamMeGroups } from "@/lib/api/generated/client";
import type { Group } from "@/lib/api/generated/models";

async function fetchGroups(): Promise<Group[]> {
	const response = await getApiV1IamMeGroups(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load groups."));
	}

	return response.data;
}

export function AccountGroups() {
	const groupsQuery = useQuery({
		queryKey: ["me-groups"],
		queryFn: fetchGroups,
	});

	if (groupsQuery.isLoading) {
		return <div className="card muted">Loading groups…</div>;
	}

	if (groupsQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load groups.{" "}
				{groupsQuery.error instanceof Error
					? groupsQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const groups = groupsQuery.data ?? [];
	if (groups.length === 0) {
		return <div className="card muted">You are not a member of any groups.</div>;
	}

	return (
		<div className="card table-wrap">
			<table>
				<thead>
					<tr>
						<th>ID</th>
						<th>Group</th>
						<th>Description</th>
					</tr>
				</thead>
				<tbody>
					{groups.map((group) => (
						<tr key={group.id}>
							<td>{group.id}</td>
							<td>
								<Link className="row-link" href={`/admin/groups/${group.id}`}>
									{group.groupname}
								</Link>
							</td>
							<td>{group.description || "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
```

> The group links point at admin pages; non-admins simply can't open them (acceptable — the table itself is the value here).

- [ ] **Step 5: Permissions page**

Create `src/app/(protected)/account/permissions/page.tsx` (the `"me"` mode means no client wrapper is needed):
```tsx
import { AccountTabs } from "@/components/account-tabs";
import { PrincipalPermissions } from "@/components/principal-permissions";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountPermissionsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Permissions</h2>
				<p className="muted">
					Your effective permissions across namespaces, by granting group.
				</p>
			</header>
			<AccountTabs />
			<PrincipalPermissions principalId="me" />
		</section>
	);
}
```

- [ ] **Step 6: Add the tab strip to the existing profile page**

Modify `src/app/(protected)/account/page.tsx` to include `<AccountTabs />`. Replace its body with:
```tsx
import { AccountProfile } from "@/components/account-profile";
import { AccountTabs } from "@/components/account-tabs";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountPage() {
	const session = await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Profile</h2>
				<p className="muted">Manage your own Hubuum user profile.</p>
			</header>
			<AccountTabs />
			<AccountProfile currentUsername={session.username ?? null} />
		</section>
	);
}
```

- [ ] **Step 7: Typecheck + lint**

Run:
```bash
npm run typecheck && npx biome check src/components/account-tabs.tsx src/components/account-tokens.tsx src/components/account-groups.tsx "src/app/(protected)/account"
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(protected)/account" src/components/account-tabs.tsx src/components/account-tokens.tsx src/components/account-groups.tsx
git commit -m "feat: self-service account tokens, groups, and permissions"
```

---

## Part E — Service accounts (Admin)

### Task 12: Service-accounts list + create

**Files:**
- Create: `src/components/service-accounts-table.tsx`
- Create: `src/app/(protected)/admin/service-accounts/page.tsx`

**Interfaces:**
- Consumes: `getApiV1IamServiceAccounts`, `postApiV1IamServiceAccounts`, `getApiV1IamGroups` (for owner-group select); types `ServiceAccountResponse`, `NewServiceAccount`, `Group`.
- Produces: `<ServiceAccountsTable />`.

- [ ] **Step 1: Verify the groups list function name**

Run:
```bash
grep -oE "export const getApiV1IamGroups\b" src/lib/api/generated/client.ts
```
Expected: `export const getApiV1IamGroups` exists (used to populate the owner-group dropdown). If it requires a params arg, pass `undefined` as the first argument.

- [ ] **Step 2: Implement the table + create form**

Create `src/components/service-accounts-table.tsx`:
```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamGroups,
	getApiV1IamServiceAccounts,
	postApiV1IamServiceAccounts,
} from "@/lib/api/generated/client";
import type {
	Group,
	NewServiceAccount,
	ServiceAccountResponse,
} from "@/lib/api/generated/models";

async function fetchServiceAccounts(): Promise<ServiceAccountResponse[]> {
	const response = await getApiV1IamServiceAccounts(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load service accounts."),
		);
	}

	return response.data;
}

async function fetchGroups(): Promise<Group[]> {
	const response = await getApiV1IamGroups(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load groups."));
	}

	return response.data;
}

export function ServiceAccountsTable() {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [ownerGroupId, setOwnerGroupId] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const query = useQuery({
		queryKey: ["service-accounts"],
		queryFn: fetchServiceAccounts,
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "service-account-owner"],
		queryFn: fetchGroups,
	});

	const createMutation = useMutation({
		mutationFn: async (payload: NewServiceAccount) => {
			const response = await postApiV1IamServiceAccounts(payload, {
				credentials: "include",
			});

			if (response.status !== 201 && response.status !== 200) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to create service account.",
					),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			setName("");
			setDescription("");
			setOwnerGroupId("");
			setFormError(null);
			setFormSuccess("Service account created.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to create service account.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const trimmedName = name.trim();
		if (!trimmedName) {
			setFormError("Name is required.");
			return;
		}

		const parsedOwner = Number.parseInt(ownerGroupId, 10);
		if (!Number.isFinite(parsedOwner)) {
			setFormError("Select an owner group.");
			return;
		}

		const payload: NewServiceAccount = {
			name: trimmedName,
			owner_group_id: parsedOwner,
		};
		const trimmedDescription = description.trim();
		if (trimmedDescription) {
			payload.description = trimmedDescription;
		}

		createMutation.mutate(payload);
	}

	const accounts = query.data ?? [];
	const groups = groupsQuery.data ?? [];

	return (
		<div className="stack">
			<form className="card stack" onSubmit={onSubmit}>
				<h3>Create service account</h3>
				<div className="form-grid">
					<label className="control-field">
						<span>Name</span>
						<input
							required
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="e.g. dns-sync"
						/>
					</label>

					<label className="control-field">
						<span>Owner group</span>
						<select
							value={ownerGroupId}
							onChange={(event) => setOwnerGroupId(event.target.value)}
						>
							<option value="">Select a group…</option>
							{groups.map((group) => (
								<option key={group.id} value={group.id}>
									{group.groupname} (#{group.id})
								</option>
							))}
						</select>
					</label>

					<label className="control-field control-field--wide">
						<span>Description (optional)</span>
						<input
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions">
					<button type="submit" disabled={createMutation.isPending}>
						{createMutation.isPending ? "Creating..." : "Create service account"}
					</button>
				</div>
			</form>

			<div className="card table-wrap">
				<div className="table-header">
					<h3>Service accounts</h3>
					<span className="muted">{accounts.length} loaded</span>
				</div>
				{query.isError ? (
					<div className="error-banner">
						Failed to load service accounts.{" "}
						{query.error instanceof Error
							? query.error.message
							: "Unknown error"}
					</div>
				) : null}
				<table>
					<thead>
						<tr>
							<th>ID</th>
							<th>Name</th>
							<th>Owner group</th>
							<th>Status</th>
							<th>Created</th>
						</tr>
					</thead>
					<tbody>
						{accounts.map((account) => (
							<tr key={account.id}>
								<td>{account.id}</td>
								<td>
									<Link
										className="row-link"
										href={`/admin/service-accounts/${account.id}`}
									>
										{account.name}
									</Link>
								</td>
								<td>#{account.owner_group_id}</td>
								<td>{account.disabled_at ? "Disabled" : "Active"}</td>
								<td>{new Date(account.created_at).toLocaleString()}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: List page**

Create `src/app/(protected)/admin/service-accounts/page.tsx`:
```tsx
import { ServiceAccountsTable } from "@/components/service-accounts-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AdminServiceAccountsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Admin</p>
				<h2>Service accounts</h2>
				<p className="muted">
					Non-human principals for automation. Create one, then mint scoped
					tokens for it.
				</p>
			</header>
			<ServiceAccountsTable />
		</section>
	);
}
```

- [ ] **Step 4: Typecheck + lint**

Run:
```bash
npm run typecheck && npx biome check src/components/service-accounts-table.tsx "src/app/(protected)/admin/service-accounts/page.tsx"
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/service-accounts-table.tsx "src/app/(protected)/admin/service-accounts/page.tsx"
git commit -m "feat: service account list and creation"
```

### Task 13: Service-account detail (edit, disable, delete, tokens, groups, permissions)

**Files:**
- Create: `src/components/service-account-detail.tsx`
- Create: `src/app/(protected)/admin/service-accounts/[serviceAccountId]/page.tsx`

**Interfaces:**
- Consumes: `getApiV1IamServiceAccountsByServiceAccountId`, `patchApiV1IamServiceAccountsByServiceAccountId`, `deleteApiV1IamServiceAccountsByServiceAccountId`, `postApiV1IamServiceAccountsByServiceAccountIdDisable`, `getApiV1IamGroups`; reusable `TokenList`, `TokenMintForm`, `RawTokenReveal`, `PrincipalPermissions`; types `ServiceAccountResponse`, `UpdateServiceAccount`, `Group`.

- [ ] **Step 1: Implement the detail component**

Create `src/components/service-account-detail.tsx`:
```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { PrincipalPermissions } from "@/components/principal-permissions";
import { RawTokenReveal } from "@/components/raw-token-reveal";
import { TokenList } from "@/components/token-list";
import { TokenMintForm } from "@/components/token-mint-form";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1IamServiceAccountsByServiceAccountId,
	getApiV1IamGroups,
	getApiV1IamServiceAccountsByServiceAccountId,
	patchApiV1IamServiceAccountsByServiceAccountId,
	postApiV1IamServiceAccountsByServiceAccountIdDisable,
} from "@/lib/api/generated/client";
import type {
	Group,
	ServiceAccountResponse,
	UpdateServiceAccount,
} from "@/lib/api/generated/models";

type ServiceAccountDetailProps = {
	serviceAccountId: number;
};

async function fetchServiceAccount(
	id: number,
): Promise<ServiceAccountResponse> {
	const response = await getApiV1IamServiceAccountsByServiceAccountId(id, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load service account."),
		);
	}

	return response.data;
}

async function fetchGroups(): Promise<Group[]> {
	const response = await getApiV1IamGroups(undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load groups."));
	}

	return response.data;
}

export function ServiceAccountDetail({
	serviceAccountId,
}: ServiceAccountDetailProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [description, setDescription] = useState("");
	const [ownerGroupId, setOwnerGroupId] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);
	const [rawToken, setRawToken] = useState<string | null>(null);

	const accountQuery = useQuery({
		queryKey: ["service-account", serviceAccountId],
		queryFn: async () => fetchServiceAccount(serviceAccountId),
	});
	const groupsQuery = useQuery({
		queryKey: ["groups", "service-account-owner"],
		queryFn: fetchGroups,
	});

	useEffect(() => {
		if (initialized || !accountQuery.data) {
			return;
		}
		setDescription(accountQuery.data.description ?? "");
		setOwnerGroupId(String(accountQuery.data.owner_group_id));
		setInitialized(true);
	}, [initialized, accountQuery.data]);

	const updateMutation = useMutation({
		mutationFn: async (payload: UpdateServiceAccount) => {
			const response =
				await patchApiV1IamServiceAccountsByServiceAccountId(
					serviceAccountId,
					payload,
					{ credentials: "include" },
				);
			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to update service account.",
					),
				);
			}
			return response.data;
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["service-account", serviceAccountId],
			});
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			setFormError(null);
			setFormSuccess("Service account updated.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to update service account.",
			);
		},
	});

	const disableMutation = useMutation({
		mutationFn: async () => {
			const response =
				await postApiV1IamServiceAccountsByServiceAccountIdDisable(
					serviceAccountId,
					{ credentials: "include" },
				);
			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to disable service account.",
					),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["service-account", serviceAccountId],
			});
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			await queryClient.invalidateQueries({
				queryKey: ["principal-tokens", serviceAccountId],
			});
			setFormError(null);
			setFormSuccess("Service account disabled. Its tokens no longer validate.");
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to disable service account.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const response =
				await deleteApiV1IamServiceAccountsByServiceAccountId(serviceAccountId, {
					credentials: "include",
				});
			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to delete service account.",
					),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
			router.push("/admin/service-accounts");
			router.refresh();
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to delete service account.",
			);
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);
		setFormSuccess(null);

		const original = accountQuery.data;
		if (!original) {
			setFormError("Service account data is unavailable.");
			return;
		}

		const payload: UpdateServiceAccount = {};
		const trimmedDescription = description.trim();
		if (trimmedDescription !== (original.description ?? "")) {
			payload.description = trimmedDescription || null;
		}
		const parsedOwner = Number.parseInt(ownerGroupId, 10);
		if (Number.isFinite(parsedOwner) && parsedOwner !== original.owner_group_id) {
			payload.owner_group_id = parsedOwner;
		}

		if (!Object.keys(payload).length) {
			setFormSuccess("No changes to save.");
			return;
		}

		updateMutation.mutate(payload);
	}

	function onDisable() {
		if (
			!window.confirm(
				"Disable this service account? This is irreversible — there is no enable endpoint. All its tokens stop validating and pending tasks are cancelled.",
			)
		) {
			return;
		}
		disableMutation.mutate();
	}

	function onDelete() {
		if (!window.confirm(`Delete service account #${serviceAccountId}?`)) {
			return;
		}
		deleteMutation.mutate();
	}

	if (accountQuery.isLoading) {
		return <div className="card">Loading service account...</div>;
	}

	if (accountQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load service account.{" "}
				{accountQuery.error instanceof Error
					? accountQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const account = accountQuery.data;
	if (!account) {
		return (
			<div className="card error-banner">
				Service account data is unavailable.
			</div>
		);
	}

	const groups = groupsQuery.data ?? [];
	const disabled = Boolean(account.disabled_at);
	const busy =
		updateMutation.isPending ||
		disableMutation.isPending ||
		deleteMutation.isPending;

	return (
		<section className="stack">
			<header className="detail-identity">
				<div className="scope-heading">
					<h2>
						{account.name} <span className="muted">#{account.id}</span>
					</h2>
					<Link className="link-chip" href="/admin/service-accounts">
						Back to service accounts
					</Link>
				</div>
				<p className="detail-title-meta">Service account</p>
			</header>

			{disabled ? (
				<div className="warning-banner">
					This service account is disabled (since{" "}
					{new Date(account.disabled_at as string).toLocaleString()}). Its
					tokens no longer validate, and it cannot mint new tokens. Disabling is
					irreversible.
				</div>
			) : null}

			<form className="card stack" onSubmit={onSubmit}>
				<h3>Profile</h3>
				<div className="form-grid">
					<label className="control-field">
						<span>Name</span>
						<input value={account.name} readOnly disabled />
					</label>

					<label className="control-field">
						<span>Owner group</span>
						<select
							value={ownerGroupId}
							onChange={(event) => setOwnerGroupId(event.target.value)}
							disabled={busy}
						>
							{groups.map((group) => (
								<option key={group.id} value={group.id}>
									{group.groupname} (#{group.id})
								</option>
							))}
						</select>
					</label>

					<label className="control-field control-field--wide">
						<span>Description</span>
						<input
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							disabled={busy}
						/>
					</label>
				</div>

				{formError ? <div className="error-banner">{formError}</div> : null}
				{formSuccess ? <div className="muted">{formSuccess}</div> : null}

				<div className="form-actions form-actions--spread">
					<button type="submit" disabled={busy}>
						{updateMutation.isPending ? "Saving..." : "Save changes"}
					</button>
					<div className="form-actions">
						<button
							type="button"
							className="ghost"
							onClick={onDisable}
							disabled={busy || disabled}
						>
							{disableMutation.isPending ? "Disabling..." : "Disable"}
						</button>
						<button
							type="button"
							className="danger"
							onClick={onDelete}
							disabled={busy}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete"}
						</button>
					</div>
				</div>
			</form>

			<div className="stack">
				<h3>Tokens</h3>
				{disabled ? (
					<div className="muted">
						Disabled service accounts cannot mint new tokens.
					</div>
				) : (
					<>
						{rawToken ? (
							<RawTokenReveal
								token={rawToken}
								onDismiss={() => setRawToken(null)}
							/>
						) : null}
						<TokenMintForm
							principalId={serviceAccountId}
							onMinted={(token) => setRawToken(token.token)}
						/>
					</>
				)}
				<TokenList principalId={serviceAccountId} />
			</div>

			<div className="stack">
				<h3>Effective permissions</h3>
				<PrincipalPermissions principalId={serviceAccountId} />
			</div>
		</section>
	);
}
```

- [ ] **Step 2: Detail page (RSC wrapper)**

Create `src/app/(protected)/admin/service-accounts/[serviceAccountId]/page.tsx`:
```tsx
import { notFound } from "next/navigation";

import { ServiceAccountDetail } from "@/components/service-account-detail";
import { requireServerSession } from "@/lib/auth/guards";

type PageProps = {
	params: Promise<{ serviceAccountId: string }>;
};

function parseId(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return null;
	}
	return parsed;
}

export default async function AdminServiceAccountDetailPage({
	params,
}: PageProps) {
	await requireServerSession();
	const { serviceAccountId } = await params;
	const parsed = parseId(serviceAccountId);

	if (parsed === null) {
		notFound();
	}

	return (
		<section className="stack">
			<ServiceAccountDetail serviceAccountId={parsed} />
		</section>
	);
}
```

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npm run typecheck && npx biome check src/components/service-account-detail.tsx "src/app/(protected)/admin/service-accounts"
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/service-account-detail.tsx "src/app/(protected)/admin/service-accounts/[serviceAccountId]"
git commit -m "feat: service account detail with token and permission management"
```

### Task 14: Admin navigation link

**Files:**
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Add the nav item**

In `src/components/app-shell.tsx`, add a "Service accounts" entry to `adminLinks`, after the Groups entry. Replace:
```tsx
	{
		href: "/admin/groups",
		label: "Groups",
		icon: <IconUsers />,
		hint: "Groups: manage role assignments",
	},
	{
		href: "/admin/remote-targets",
```
with:
```tsx
	{
		href: "/admin/groups",
		label: "Groups",
		icon: <IconUsers />,
		hint: "Groups: manage role assignments",
	},
	{
		href: "/admin/service-accounts",
		label: "Service accounts",
		icon: <IconUser />,
		hint: "Service accounts: non-human principals for automation",
	},
	{
		href: "/admin/remote-targets",
```

> `IconUser` is already defined in this file (used by the Users link). Reusing it avoids adding a new icon.

- [ ] **Step 2: Confirm the section-title helper covers the new route (optional polish)**

The `getSectionTitle` helper returns "Admin" for `/admin/*` paths already (it checks the `/admin` prefix). No change required. Verify:
```bash
grep -n "/admin" src/components/app-shell.tsx | head
```
Expected: an existing `/admin` prefix check; nothing to change.

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npm run typecheck && npx biome check src/components/app-shell.tsx
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat: add service accounts to admin navigation"
```

---

## Final verification

### Task 15: Full-suite verification and spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-06-28-auth-principals-scoped-tokens-service-accounts-design.md`

- [ ] **Step 1: Run the full gate**

Run:
```bash
npm run typecheck && npm run lint && npm test
```
Expected: all pass.

- [ ] **Step 2: Build smoke (catches RSC/client boundary issues)**

Run:
```bash
npm run build
```
Expected: build succeeds. If a page errors with a server/client boundary problem, ensure every interactive component file begins with `"use client"` and that RSC `page.tsx` files only pass serializable props.

- [ ] **Step 3: Manual smoke (if a backend is available)**

Start the dev server (`npm run dev`) and verify: login still works; `/account/tokens` mints an unscoped token (reveal shown once) and a scoped token (scope checkboxes), and revoke works; `/account/groups` and `/account/permissions` render; Admin → Service accounts creates an SA, opens detail, mints a token for it, and disable shows the banner. If no backend is available, note this step was skipped.

- [ ] **Step 4: Mark the spec complete**

In the spec file, change `**Status:** Approved (design)` to `**Status:** Implemented`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-28-auth-principals-scoped-tokens-service-accounts-design.md
git commit -m "docs: mark PR #94 auth adaptation spec implemented"
```

---

## Self-review notes

- **Spec coverage:** Part A→Task 1 (regen); rename+endpoint moves→Tasks 2–6; `proper_name`→Task 3; me self-service→Tasks 7–11; scoped tokens→Tasks 7–9, 11, 13; service accounts→Tasks 12–14; nav→Task 14; testing→Tasks 7, 8, 15; caveats (one-way disable, kind badges)→Tasks 4, 13.
- **Type consistency:** `useCurrentUserId(currentUsername)` returns the principal id used as `principalId` throughout; `TokenMintForm.onMinted(token: PrincipalToken)` feeds `RawTokenReveal token={token.token}`; member math uses `principal_id` consistently after Task 4.
- **Known uncertainty:** generated function names and the mint 201 body are confirmed/handled in Task 1 and the mint mutation (runtime-parsed body cast to `PrincipalToken`). If orval emits different names, Task 1 Step 4 surfaces them before later tasks rely on them.
