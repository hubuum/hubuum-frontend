# Retry-safe task submissions

Hubuum task-creation endpoints support `Idempotency-Key`. The console uses that
contract for imports, exports, backup generation, stored-template execution, and
remote-target invocation.

## Browser retry leases

Before submitting an operation, the frontend derives a SHA-256 fingerprint from:

- the operation kind;
- the target identifier where applicable; and
- a canonical JSON representation of the request payload.

The browser stores only that fingerprint, an opaque idempotency key, and its
creation time in `sessionStorage`. The request payload is not stored. A retry of
the same operation in the same tab reuses the key, including the case where the
server accepted a task but the response was lost before the browser received
it.

A successful `202 Accepted` response completes and removes the retry lease, so
a later intentional submission of the same payload creates a new task. An
abandoned lease expires after 30 minutes. At most 64 leases are retained per
tab. When browser storage is unavailable, the current page process keeps the
same bounded retry state in memory.

## Explicit keys

The import workspace retains its optional explicit idempotency-key field. A
provided key seeds the same retry lease and remains subject to the server's
255-byte limit. If the UI generates a candidate key for an operation, an
already-active lease for the same payload takes precedence so a repeated click
does not accidentally replace the retry identity.

## Scope

This mechanism protects creation of asynchronous tasks. It does not implement
optimistic concurrency for resource updates. Revision and ETag handling belongs
to the backend API contract and should be added separately when that contract is
available.
