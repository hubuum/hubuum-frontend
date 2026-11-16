# Interactive sessions

Frontend v0.0.22 requires the `/api/v1/auth` contract in Server v0.0.20.
Upgrade both components together and sign in again after deployment. No password
is retained after login. Both credentials stay in the server-side Valkey record;
the browser receives only the existing HttpOnly, SameSite session cookie.
The generic BFF proxy blocks login and refresh paths, including encoded paths.
Credential-management flows continue to require a fresh password approval.
Approvals are bound to the access credential that requested them; if rotation
occurs before the approved write, obtain a new approval with the current session.

Before an access token expires, the BFF atomically claims its credential generation
in Valkey. Other instances wait for the complete replacement pair. A claim never
expires back into a reusable refresh token: after a crash, timeout, rejected
refresh, or ambiguous response, sign-in is required. This avoids replay revoking
a family when a request succeeded but its response was lost. Rotation does not
extend the server's absolute session deadline.

Configure rotation on the server with `HUBUUM_SESSION_ACCESS_SECONDS` (900 seconds
by default). For example, `3600` gives access tokens a one-hour lifetime; the BFF
refreshes shortly before expiry. `HUBUUM_SESSION_IDLE_SECONDS` and
`HUBUUM_SESSION_ABSOLUTE_SECONDS` separately bound inactivity and total session
lifetime. Restart the server after changing these settings and sign in again to
use the new policy; existing sessions retain the policy from login.

Pair replacement requires both the claimed generation and its owner nonce.
Session touches update only activity time with the same generation check. Logout
removes the record, so an in-flight refresh cannot recreate it; a received pair
that cannot be stored is revoked on a best-effort basis. Process-local request
coalescing is only an optimization; Valkey provides coordination across replicas.

An upstream rejection invalidates only the access generation used by that request.
If a newer generation exists or rotation is in progress, the BFF preserves the
session and returns `409 session_rotated` with retry guidance. It does not replay
the request. Protected page guards reload and validate the replacement credential
before rendering. Explicit logout still removes the entire local session.

Valkey TTL is the minimum of `SESSION_TTL_SECONDS`, the refresh deadline, and the
absolute session deadline. The cookie is bounded by those limits at login and
is not extended by a background refresh. The server remains authoritative for
expiry and revocation. Signing out of all sessions preserves independent PATs.

## Protecting the session store

Valkey holds usable credentials and must be treated as a secret store. Use a
private network, authenticated access, TLS (`rediss://`) when traffic crosses a
trust boundary, and operator-managed encryption for persisted volumes and
backups. Application-level encryption is not added: it would require a shared
key and rotation policy across replicas while leaving the live application able
to decrypt every record. Deployments requiring it should use a managed encrypted
store or volume encryption with a separate key-management boundary. Avoid
persisting ephemeral session data when recovery is unnecessary.

Credentials and response payloads are excluded from refresh logs. Session
endpoints and browser responses use `Cache-Control: no-store`. A lost session
store requires sign-in again and never falls back to browser-stored credentials.

## Verification

Unit tests exercise independent refresh callers, uncertain outcomes, failed
instances, logout races, and browser secret boundaries. Run the real atomic-store
regressions against a disposable Valkey instance:

```bash
HUBUUM_TEST_VALKEY_URL=redis://127.0.0.1:6379/0 \
  npm test -- src/lib/auth/session-store.integration.test.ts
```

The tests use a unique key prefix and remove only their own records.

## Project #6 browser authentication

These routes belong to `project/auth-support` and require the accepted project
server. The existing local/LDAP password and rotating-session APIs remain
available. Browser login and administrator controls are delivered separately in
frontend #197/#198 after the BFF #196 candidate is accepted. No project push
publishes the stable website or container.

The BFF creates a purpose-bound interaction using its registered client
`hubuum-frontend`. Hubuum owns upstream callbacks, provider requests and explicit
user approval. The browser receives the public verification URL/code and a return
nonce; it never receives the interaction redemption capability. The nonce cannot
redeem an interaction. Valkey binds it to the initiating opaque cookie, backend
connection/revision, purpose and, for privileged work, the original session family.

| Frontend route | Contract |
| --- | --- |
| `GET /_hubuum-bff/auth/methods` | Validated public methods and capabilities; only an actual unsupported discovery response permits the existing password interface. |
| `POST /_hubuum-bff/auth/interactions` | Begin login, exact prepared credential approval or administrator provider verification. Requires same-origin mutation metadata. |
| `GET /_hubuum-bff/auth/interactions/return` | Validate the bound identifier/nonce/cookie, claim completion once and redirect to the saved local return path. |
| `POST /_hubuum-bff/auth/interactions/<id>/result` | Read nonce-bound progress or consume a completed result once. Upstream polling is serialized and respects its interval/Retry-After. |
| `POST /_hubuum-bff/auth/interactions/<id>/cancel` | Cancel the matching nonce-bound flow and clean up its exact issued family. |

Configure `AUTH_BROWSER_ORIGIN` when Hubuum's public browser origin differs from
`BACKEND_BASE_URL`. Register a Hubuum BFF return target with ID
`AUTH_BFF_RETURN_TARGET_ID` (default `frontend`), client `hubuum-frontend`, and the
exact deployed URI `https://console.example/_hubuum-bff/auth/interactions/return`.
These are deployment trust settings. Per-provider definitions and credentials
remain runtime-managed by Hubuum. HTTPS and certificate validation remain enabled;
use a trusted CA for the backend connection.

Login installs the existing private access/refresh pair and rotates the opaque
`hubuum.sid` cookie. Ordinary requests keep the existing distributed refresh
protocol. Interaction callbacks read ownership metadata without refreshing the
credential that owns an in-flight privileged operation. A lost frontend response
can redeliver the same accepted opaque cookie for five minutes, without issuing
another backend session. After that handoff window, sign in again; any previously
issued session retains its ordinary expiry/revocation policy. Logout removes its
session, so an old handoff cannot restore it.

Fresh approval captures the exact method, path, body, original bearer and relevant
conditional/idempotency headers. Token expiry retains the server's microseconds.
Protected mutations are sent once. An interrupted result requires inspection of
the affected account, task or restore before a new approval. Deliberate one-time
PAT output remains an explicit credential-management result; login access/refresh
pairs and approval capabilities stay private. OAuth freshness is explicitly
unsupported and never triggers a password downgrade.

Provider verification stores activation receipts privately and returns only its
non-provisioning preview. The private record also retains a one-way fingerprint
of the initiating credential for the administrator activation handoff. Candidate
ownership includes the initiating credential;
credential rotation or expiry requires a fresh candidate/test. Raw interactions,
callbacks and security candidates are blocked by the generic browser proxy.

Valkey allows at most four pending flows per browser. Completion and cancellation
share an atomic claim. Abandoned claims retain cleanup authority for the server's
bounded one-hour post-expiry window. Every frontend process runs a bounded cleanup
worker; claim transfer fences a delayed handler, then cancellation precedes exact
family revocation. Recovery never repeats completion or a protected mutation.
Cleanup needs reachable Valkey and the original configured backend before that
window ends. Unconfirmed cleanup is reported explicitly and requires local
recovery administration. Long outages and backend changes cannot establish that
an abandoned family was revoked.

The stdlib-only Python 3.11+ driver `tests/integration/authentication.py` runs the
actual production Next.js BFF over verified TLS with source-pinned provider/server
fixtures and disposable private Valkey. Its reports exclude credentials and
profile data and identify the compiled production server tree. Its actual
Chromium return check pins the disposable TLS certificate's public key and
checks cookie rotation, replay and empty browser storage without persistent
browser profiles or trace files. Run after `npm run build`, supplying the accepted
server fixture checkout, immutable image, Node 24 executable, provider profile
(`id_token`, `userinfo`, `oauth`, `ldap` or `local`) and an evidence directory:

```bash
python3 tests/integration/authentication.py --help
```

The LDAP profile provisions and verifies the directory through the server fixture;
it qualifies hosted BFF login and fresh approval, while the dedicated browser
candidate preview runs for OIDC/OAuth. This BFF driver does not establish React
login/setup UI or native real GitHub acceptance; those remain part of server #581.

The clean-source production matrix passed **102/102 checks**: local 17, LDAPS 20,
Keycloak ID-token 23, UserInfo 21 and synthetic OAuth 21. This includes actual
Chromium cookie/storage/replay checks, response loss before cookie delivery,
server-completion response loss, SIGKILL recovery after backend issuance and an
uncertain protected mutation without replay. The
[sanitized qualification ledger](assets/authentication-qualification.json) binds
all five profiles to one clean source and compiled production server tree.
