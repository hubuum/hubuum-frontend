# Operational observability

Hubuum Frontend emits one-line JSON operational events from server-side code.
The schema is designed for collection by ordinary container log pipelines and
does not require a vendor-specific telemetry agent.

## Envelope

Every event includes:

```json
{
  "timestamp": "2026-08-03T10:00:00.000Z",
  "level": "info",
  "service": "hubuum-frontend",
  "event": "bff.proxy.completed"
}
```

Additional fields are flat JSON primitives. Field names and event names use
lowercase dot, dash, and underscore notation. Strings are capped at 512
characters, non-finite numbers become `null`, and nested values are ignored.

## Privacy and credential safety

The formatter rejects fields whose names identify credentials or request
content, including authorization headers, cookies, passwords, tokens, session
IDs, restore capabilities, request bodies, and payloads. Credential-looking
values embedded in error messages are redacted, and error stacks are not
emitted.

Backend paths keep their route and query-parameter names for aggregation, but
all query values are replaced with `[redacted]`. Credential-bearing path
segments are also removed. Callers should still pass only the safe path returned
by `getSafeBackendPathForLogs` or `sanitizeOperationalPath`.

These controls are a final boundary, not permission to pass arbitrary request
objects to the logger.

## Event catalog

### Generic browser-to-backend proxy

- `bff.proxy.completed` — backend response headers received; includes method,
  safe path, source BFF path, status, correlation ID, duration, and content
  lengths when known.
- `bff.proxy.failed` — upstream connection or fetch failure with bounded error
  identity.
- `bff.proxy.rejected` — unsupported method or invalid upstream path.
- `bff.proxy.unauthenticated` — request rejected before proxying because no
  frontend session was available.

### Direct server-side backend calls

- `backend.request.completed` — login, settings, raw-report, and other
  server-side backend requests; includes method, safe path, status, correlation
  ID, duration, and response length when known.
- `backend.request.failed` — backend fetch failed before a response was
  available.

### Valkey

- `valkey.connection.ready`
- `valkey.connection.reconnecting`
- `valkey.connection.closed`
- `valkey.connection.ended`
- `valkey.connection.error`
- `valkey.ping.failed`

No event includes the Valkey URL or key names.

## Suggested operational views

A log backend can derive useful service indicators without parsing prose:

- request rate and status families by `event`, `method`, and `path`;
- p50, p95, and p99 `duration_ms` for `bff.proxy.completed` and
  `backend.request.completed`;
- upstream transport failures per minute;
- unauthenticated-request spikes;
- Valkey reconnect and terminal-connection events; and
- correlation-ID timelines spanning the frontend and Hubuum Server.

The duration currently measures time until backend response headers are
available. For streamed responses, transfer duration and client cancellation
should be recorded as separate events rather than changing this field's
meaning.

## Adding events

Use `emitOperationalEvent` from `src/lib/operational-events.ts`. Add a focused
unit test when introducing a new field category or redaction rule. Prefer one
completion event over paired start/finish messages unless an operation is long
running and in-flight visibility is operationally necessary.
