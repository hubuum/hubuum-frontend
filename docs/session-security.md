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
