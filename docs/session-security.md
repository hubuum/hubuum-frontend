# Interactive sessions

Frontend v0.0.22 requires the `/api/v1/auth` contract in Server v0.0.20.
Upgrade both components together and sign in again after deployment. No password
is retained after login. Both credentials stay in the server-side Valkey record;
the browser receives only the existing HttpOnly, SameSite session cookie.
The generic BFF proxy blocks login and refresh paths, including encoded paths.
Released-server credential-management flows require a fresh password approval.
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
available. Browser login and administrator controls are delivered in frontend
issues #197/#198 above the accepted BFF #196 foundation. No project push
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

### Project login and approval interface

The login form discovers versioned methods through the BFF. Only a missing
interaction contract permits legacy provider discovery. Other failures require
an explicit local recovery choice, and a remembered provider that disappears
requires a new selection. Browser providers never receive a password fallback.
Fresh approval selects its method using the current principal's canonical
identity scope, rather than parsing a display name.

The initiating tab retains only public identifier/nonce/code metadata. Polling
respects the server interval and Retry-After and ends at the bounded deadline.
Cancellation addresses only that request. Completion does not repeat a protected
mutation; an uncertain result requires inspection. Navigated callback failures
have a friendly page with an allowlisted outcome, while JSON clients keep typed
errors. The ordinary opaque session cookie is shared across tabs; approval
ownership remains per request and exact operation.

Login and approval passwords use uncontrolled fields and clear after submission.
Browser storage and React state receive no session pair, redemption capability,
activation receipt or upstream credential. The existing explicit one-time PAT
reveal is a separate credential-management output. The `--browser-ui` mode of the
production qualification driver exercises actual product login and token creation
through the supported authentication method, with credentials only in memory,
verified TLS and no screenshots, traces or persistent browser profiles.

## Qualified product login and approval UI

The clean production UI source `d3fcef25660594bfeaccfd42296c36f238f42644` passed **50/50** checks across local accounts (7), LDAPS (9), synthetic OAuth (10), and both real disposable Keycloak ID-token/UserInfo profiles (12 each). The [sanitized ledger](assets/authentication-qualification.json) pins server #598, controller/report/image hashes and the compiled standalone tree. Credentials, callback query strings, browser profiles and traces are excluded.

The UI fixture allows complete form interactions on a 30-second eligibility schedule, then explicitly waits past the next renewal. Concurrent OIDC tabs preserve separate frozen operations: approval creates one credential, denial creates none, and the ordinary session retains its principal after renewal. Callback denial may close the approval dialog and surface on the original operation form; poll-first denial may remain in the dialog. Temporary read-only eligibility responses use bounded fixture retries; protected writes never replay. Separate server protocol fixtures retain five-second refresh stress coverage.

Browser UI #197 is accepted through PR #209, integration `09995e99197fd5ed496e16363cfa498831b00242`, after final CI, container and immutable candidate verification. This is implementing-agent acceptance, not independent approval. Provider administration #198 and the full native real GitHub/server #581 matrix remain separate required gates. Project integration does not promote main or stable.

## Runtime security administration

The fixed private BFF administrator routes enforce same-origin mutations,
ordinary session ownership and administrator access. Candidate receipts remain
in Valkey, bound to the backend target, opaque frontend session, original token
fingerprint and server candidate identity/expiry. Rotation requires recreating
and testing the candidate; a receipt is never rebound to a replacement token.
The browser can submit settings and test identities, receive redacted checks and
a non-provisioning preview, and approve activation with a local administrator
password. It cannot select an arbitrary approval operation or supply a receipt.
The BFF constructs the exact candidate/group/revision approval and performs the
protected activation once. An uncertain result requires status/configuration
inspection; it never starts an automatic mutation retry.

The frontend preserves Keep/Reference/Replace/Clear intent for each credential.
Values and aliases use uncontrolled write-only inputs, clear on capture, and
never enter React state, local/session storage or review summaries. The server
owns validation, encryption, secret-version/revision/lock fences, egress and TLS.
Draft provider settings contain only non-secret protocol and membership policy.
Unknown provider/backend definitions, missing capabilities, stale replicas and
non-local or scoped actors leave security controls disabled or read-only.

`tests/fixtures/authentication/fixtures.json` retains the unmodified 48-case
shared corpus at SHA-256
`027eff028cb1c7252132f1f93225957f548ccb0dd839e2b7e5c291efb872c028`.
The owning Vitest checks cover bounded wire parsing, closed errors, interaction
binding, connectivity versus identity verification, and private-receipt
redaction. The historical discovery vector predates `browser_available`; its
explicit augmentation is tested separately while production parsing remains
strict. Database/provider/authorization and membership effects belong to the
server's integration checks; wire fixtures do not establish those effects.

The production fixture accepts `--admin-ui` to drive the real configuration,
provider test and activation screens before native login/approval qualification.
It checks six persistent table counts around preview through a bounded private
stdin/stdout checkpoint controller, and updates the disposable Keycloak client's
exact callback after candidate creation. No test credentials, profile data,
callback query strings, traces, screenshots or persistent browser profile are
retained. The synthetic OAuth profile is not real GitHub acceptance. Final clean
source/image evidence must be recorded in the qualification ledger before an
administration candidate is accepted.

## Qualified runtime administration

The [administration ledger](assets/provider-administration-qualification.json)
records 63 clean production checks across local, LDAPS, synthetic OAuth and both
real Keycloak profiles, plus 12 real Treetop checks. It pins qualified source
`0ddc0e7be6357143003a1abc1144f750b2d4e702`, accepted server #599, separate normal/Treetop feature images,
controller/report hashes and the compiled standalone tree. Candidate preparation
leaves all six identity, membership, session and credential counts unchanged;
exact fresh local approval activates the reviewed revision. Releasing ownership
verifies the complete deployment selection and sends no runtime connection.

Real Treetop coverage includes rejected unreachable and deny-policy preflight,
restart/reconnect, fail-closed outage, explicit Local activation and deployment
ownership release. Local accounts remain configured. During a policy outage,
new login can fail because its audit snapshot consults the selected policy;
use the server's documented offline `hubuum-admin --recover-security` procedure
with privileged writes stopped across all replicas. Login is requalified after
reconnect. No automatic authorization fallback is performed.

Final frontend CI and immutable candidate acceptance are required before #198
is completed. Native real GitHub and the full #581 matrix remain separate gates.
