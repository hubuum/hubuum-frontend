# Use the web frontend

Sign in to your organization’s frontend with an account authorized for the
resources you need. Start with [Atlas](example-dataset.md) for a shared example.

## Credential operations

Servers enforcing fresh authentication for credential management trigger a
current-password confirmation after returning `403` with
`reason: reauthentication_required`. This covers token creation and renewal,
local user creation, password updates, credential-bearing imports (including dry
runs), and restore confirmation. The submitted operation is frozen while the
confirmation is open. The BFF obtains and immediately consumes a single-use
approval with the same session bearer, preserving the exact request and the
server-resolved token expiry. Passwords are discarded after submission; approval
secrets never reach browser JavaScript or browser storage.

Older servers continue accepting the original requests without an approval
endpoint or an extra password prompt. Ordinary permission failures do not
trigger confirmation. An incorrect confirmation password preserves a valid
session, and failed or ambiguous mutations are never retried automatically.
After a lost response, inspect the affected credentials, task, or restore before
trying again. Imports retain their idempotency key through both BFF paths.

## Scoped identities

The login form accepts an optional identity scope. Blank values and `local`
select local Hubuum users; any other value is forwarded as `identity_scope` for
the matching configured authentication provider. After login, the BFF verifies
the issued token against `/api/v1/iam/me`. This prevents an older backend that
ignores the new field from accidentally authenticating a same-named local user.
When the public provider-discovery endpoint is available, the form presents its
scopes as a select menu when multiple options exist; a sole provider is
selected implicitly. The password field has a visibility toggle, and optional
background choices live under Appearance. A missing, failed, or malformed discovery
response keeps the manual identity-scope field available for older servers.

Principal and group labels include their non-local scope where names can be
ambiguous. Provider-managed user profiles, groups, and synchronized group
memberships are read-only in the console. Users can still be assigned to local
groups, including users that originated from a provider.
Import permission selectors include `GroupKey.identity_scope`, and the import
workspace defaults omitted scopes to `local` to match the backend contract.

Service-account credentials expose the backend's two independent token-scope
dimensions. Permission scopes select allowed operations, while resource scopes
select collections, classes, and objects through unified name search. The
effective authority remains the intersection of the principal's live group
grants, the permission scope, and the resource scope. The admin creation flow
creates the account and its first scoped token together; later tokens use the
same guided scope controls on the account detail page. The owner group controls
who can manage a service account but does not grant runtime access, so the
account still needs live group membership before its token has effective
authority. Server `v0.0.4` represents both boundaries under one nullable
`scope` object, and token lists show the exact permission and resource
dimensions returned by the server. Selecting a listed token opens its complete
lifecycle metadata and every permission, collection, class, and object boundary.
Resource names are resolved beside their exact IDs without exposing the bearer
token or stored hash. A listed token can be cloned from its detail view: the
creation flow copies its exact permission and resource boundaries while using a
fresh expiry, including for expired tokens once the server returns them. Server
`v0.0.5` publishes its effective default token
lifetime and returns the authoritative expiry for each newly issued token. The
console shows that default beside optional expiry fields while leaving the
server responsible for materializing omitted expiries. Server `v0.0.9` also
publishes the maximum token lifetime and adds revisioned token metadata and
renewal endpoints. Human users with an
unscoped session token can mint tokens for themselves from their Account page.
Human admins can mint for any principal, and human members of a service
account's owner group can manage its tokens from their Account page.
Service-account actors never receive token-minting controls, and disabled
service accounts cannot receive new tokens. Local group membership editors can
add either human users or service accounts by name, and each service-account
detail page lists its current runtime group memberships separately from its
owner group.

## Workspace navigation and resource selection

Use **Go to…** or **Ctrl/Cmd+K** to find a workspace destination, pinned resource,
or the current page's create action. The desktop control shows its shortcut;
the empty workspace search shows **Type / to search** until focused. Press **/**
outside a text field to focus workspace search or open it on a smaller screen.
Type a query and press **Enter** to activate
the first matching destination or action, or search resources when none match.
Use the arrow keys to choose a different result before pressing Enter.
Up to three pinned destinations also appear as direct links below the toolbar.
Data-menu destination links and shortcut
expansion buttons are separate controls. Mobile navigation traps keyboard focus
while open and returns it to its trigger when closed.

The Objects class picker searches all accessible classes, loads more options
with cursor pagination, and resolves selected IDs independently of the first
option page. Options include IDs and collection context to distinguish duplicate
names. Collection lookups fetch matching resources on demand and retain exact
ID entry. Supporting class and collection lists follow every cursor instead of
stopping at 250 entries. Lookup popovers stay within the viewport when opened or
resized.

**Find on this page** filters only the loaded rows. Classes and Collections also
provide **Search all** links to the full resource search. While a table changes
page, the previous rows remain visible with an updating indicator and disabled
row actions; pagination and sort changes preserve the scroll position. Arrow and
Enter shortcuts operate only within the focused table and preserve native form,
button, and link behavior.

JSON editor code loads when needed. Validation and document summaries wait for a
short typing pause; formatting runs only when requested. Error notifications and
notifications containing actions persist until dismissed. Ordinary notifications
pause while hovered or focused.

View URLs also preserve applied Audit filters and its page cursor, Exports tabs
and template-library filters, and Relations view/filter/depth controls. Browser
Back and Forward restore these controls from the URL. Shared client-side query
updates use Next.js's native History integration, preserving unrelated parameters
and anchors without requesting a new server-rendered page for each control edit.

## Object data columns

The objects workspace can promote fields from each object's JSON `data` blob
into table columns. Candidate fields are discovered from the selected class
schema when available, then augmented from the currently loaded object rows.
Discovery is page-local and shallowly bounded, so it does not trigger an
expensive full-dataset scan.

Object creation stays scoped to the selected class. The default Data editor
combines schema fields with fields observed in sampled class objects, preloads
required schema fields, and offers raw JSON as an alternate synchronized tab.
Closed schemas hide arbitrary-field creation; permissive schemas expose it.

Column preferences are stored per user and per class id. The `Data columns`
menu lets users reset to suggested fields or clear all promoted columns. The
same menu can show or hide the raw data preview column, also remembered per
class id. Portable preferences such as light/dark mode, relative text size,
workspace atmosphere, pins, and selected data columns are saved in the user
settings store, with `localStorage` used as an owner-scoped browser cache. The
Appearance page offers four complete workspace atmospheres: Sunset, Golden
Hour, Clouds, and Forest. Each atmosphere owns its action, typography, canvas,
navigation, surface, and ambient palette in both light and dark mode. Viewport
and activity state such as table widths, sidebar state, recent items, and task
last-seen timestamps stay device-local.

The `Custom data fields` menu lets users create personal fallback columns with a
label and a `|`-separated list of data paths. The table shows the first
non-empty value, so a field like
`os.fedora.version|os.redhat.version|os.macos.version` can display one
normalized `OS version` column across differently shaped object data. Personal
display definitions are stored as per-user, per-class console preferences and
affect presentation only.

Hubuum Server computed fields are separate domain resources. A class page can
create and manage shared definitions for all class readers and personal
definitions stored for the current user. Definitions support typed aggregation
and presence operations over JSON Pointer paths, can be previewed against an
existing object or sample data, and shared values can be explicitly rebuilt.
Object reads opt in with `include=computed`; enabled shared and personal values
then appear as individually selectable, per-user object-table columns, in table
exports and loaded-page search, and on object detail pages. Evaluation errors
and stale shared materializations remain visible. With Hubuum Server `v0.0.3`,
computed columns can sort the complete server result and the Server filters menu
offers result-type-aware computed predicates, including null, numeric range,
JSON containment, and negated matching.

The objects workspace can group by up to three ordered object, nested data,
shared-computed, or personal-computed fields through the server's permission-aware
aggregate resource. Use **Aggregate → Add group by** to add dimensions; move
them up or down to change their order. Multiple dimensions default to an expandable
tree with complete parent subtotals and numeric measures supplied by the server.
Use **Aggregate → View** to switch between **Tree** and **Table**.
Top-level groups load in pages when sorting by count. A–Z and Z–A use natural
numeric ordering (8, 9, 10), including numeric text and version labels. These
sorts load all aggregate pages before sorting and paging locally, in both tree
and table views, so values stay correctly ordered across page boundaries.
Expanding a level follows all of its aggregate
pages and caches the results across parents; children are matched by their exact
dimension values and states, then shown in batches. This needs no server changes,
but high-cardinality levels can take multiple requests to load. Loading progress
and retry controls appear inside the expanded branch. Table view retains one
column per dimension and one count per combination, including flat table exports.
Ordered grouping fields (`groupBy`), measures (`aggregate`), group sort
(`groupSort`), tree/table layout (`aggregateView`), and aggregate table cursor
(`aggregateCursor`) are stored in the URL. Refresh and copied links restore the
configuration; control edits replace the current history entry and pagination
adds an entry. Copied aggregate cursor links keep a **First** action even when
the previous cursor is unknown. Class changes clear the old class's aggregation
settings.
Click a count to open matching objects in a dialog without collapsing the tree.
The dialog's **Open in object table** link preserves the full group path and source
filters as editable Server filters (`objectFilters`) in the URL, opens an ungrouped
object table, supports new tabs and reloads, and lets Back return to the tree.
Matching uses server filters and cursor pagination, fetching only the requested
object page. Numeric values and their text equivalents match together; JSON null
and missing share the server null filter, as do null and unavailable computed
values. The dialog header shows the filtered total and a table-icon link. Groups
containing whole JSON objects or arrays cannot be converted to a server filter
and have a disabled count with an inline explanation. The same applies when
combining source filters and group conditions would exceed two computed filters
or eight total filters. Closing the dialog cancels its pending request.
Server filters run before aggregation, counts cover the complete matching class
rather than the loaded object page, and aggregate rows
have their own cursor pagination and exact total. Null, missing, and unavailable
computed values remain distinct. Personal custom fallback fields still use a
single loaded-page grouping because their first-non-empty path expression is a console
display preference rather than a server field. With Server `v0.0.4`, the same
workspace can add up to four ordered `sum`, `average`, `min`, or `max` measures
over numeric JSON and computed fields, either per group or as one global
aggregate. Measure cells and exports retain contributing and skipped source
counts. The report template editor also includes runnable MiniJinja `groupby`
examples for report-specific grouping and grouped CSV output. Object tables,
ad-hoc exports, and object-scoped export templates share the same server-filter
field discovery, typed operators, validation, and backend query grammar for
object, nested JSON data, and computed fields.

## Bookmarkable reports

Saved executable export templates have stable, authenticated report URLs under
`/reports/{template_id}`. The frontend remembers the latest task for the
current session, template revision, and normalized set of run overrides. It
reuses that task while its backend output remains available; otherwise it
starts a new template export, waits for the task to finish, and remembers the
replacement. Concurrent requests for the same report join one generation
through a short Valkey lock instead of submitting duplicate tasks.

The backend output body is streamed with its original content type. The
response is not wrapped in console markup or parsed/reformatted, so saving the
browser page saves the generated template result itself. HTML report responses
receive a script-disabled sandbox policy because they are served from the
console origin.

Report responses include `Server-Timing` metrics for session access, template
revision lookup, report-cache access, task validation or submission, output
time to first byte, and total server time to response headers. Body transfer
and browser rendering happen after those measurements and are not included.

Bookmark URLs can supply the supported template-run overrides through `query`,
`object_id`, `missing_data_policy`, `max_items`, and `max_output_bytes` query
parameters. Related-object templates require `object_id`. Existing stored task
outputs use `/reports/runs/{task_id}` and are streamed through the same raw
response boundary. `HEAD` requests never generate reports, and frontend links
disable Next.js prefetching so merely rendering or hovering a link cannot start
a task. An optional `max_age` parameter limits how old a completed task may be:
whole numbers are seconds, and `s`, `m`, `h`, or `d` suffixes are accepted
(`max_age=15m`). `max_age=0` explicitly forces a new run. Updating the saved
template also causes the next request to generate a new report.

The default Reports tab is a catalog of executable saved reports, while less
common one-off JSON exports have their own top-level tab. `View` opens the
stable raw URL, `Refresh now` performs one forced generation, waits for the task
to finish without opening its output stream, and redirects to the clean
bookmark URL. `Run with changes` opens the authenticated configuration
interface at `/exports/reports/{template_id}`. That interface uses the same
visual query builder as template authoring and keeps freshness, missing-data,
and output-limit overrides available without putting controls inside the
generated result. Each catalog card distinguishes the template's update time
from the current saved-default export's generation time and stored-output
expiry without generating a report during inspection. Saved-query hints
translate filters and sorting into readable field, operator, and value
descriptions, and class-scoped reports identify their class. These changes
affect only the configured URL. The saved default query can be edited directly
from each catalog card's More menu. Permanent layout, scope, include, and other
template changes remain in
`/exports/templates/{template_id}`, while new definitions start under
`/exports/templates/new`. Adding `?from={template_id}` to the new-template URL
copies an existing definition into a separately named, unsaved template.

New template authoring starts with its name, purpose, and output format before
target, query, hydration, rules, and document design. HTML templates can use a
standard-page mode where authors edit only the body. The frontend stores that
body inside a deterministic full HTML template with title and viewport
metadata, print styling, responsive typography, and readable alternating table
rows. Advanced authors can instead own the complete HTML document. In both
modes the raw report route still streams the exact generated backend output;
it never injects console controls or response-time wrappers.

Server `v0.0.4` audit events, resource history, and task lifecycle events carry
durable provenance. The console shows the immediate actor, root initiator, and
originating task where available, and audit/subscription filters can match the
root initiator independently of the worker or system actor.

## Chat webhooks

Collection managers with `ManageEventSubscription` and `ReadAudit` can create
collection-owned webhook destinations and subscriptions on the collection page
when connected to a server with collection sink support (`v0.0.18` or newer).
Saved destination URLs are write-only in this view.

Administrators can choose Slack, Mattermost, Discord, or Custom webhook when
creating an event sink. The chat presets supply message templates, acknowledgement
rules, retries, and delivery spacing while saving ordinary server webhooks.
Webhook URLs stay in the server's secret source; the console accepts the secret
name. Collection subscriptions use that configured destination automatically.
Existing sinks retain custom configuration and pacing when edited. See the
[chat webhook guide](webhooks.md) for setup and provider details.

## Administrator backup and restore

The admin-only Backup & restore workspace creates server background tasks and
downloads their portable JSON output before the configured retention deadline.
Backups can include resource and audit history, and the UI exposes the server's
size, SHA-256, and expiry metadata.

Restore is a deliberately staged operation. Selecting a backup first uploads
and validates it without changing live data. The one-time restore capability is
kept only in component memory, never browser storage. Confirmation requires the
exact phrase `REPLACE ALL HUBUUM DATA` and a second danger dialog. A confirmed
restore replaces the complete Hubuum database, including identities and
permissions, and invalidates existing sessions and tokens.
Confirmation queues the restore and keeps polling its capability-protected
status until success or failure. Keep this page open until it finishes, then
sign in again with credentials from the restored backup.

The BFF uses `/api/v1/iam/me/settings` when the backend exposes the principal
settings API. Console preferences live under a versioned `hubuum_frontend`
namespace in the raw settings document, so recursive merge patches preserve
settings owned by other clients. While connected to an older backend, the BFF
uses Valkey without the session TTL. Existing fallback preferences are migrated
automatically when the backend endpoint becomes available.

Nested data fields use dotted display paths, while literal dots and backslashes
inside object keys are escaped:

```text
metadata.owner     -> nested { "metadata": { "owner": ... } }
metadata\.owner    -> literal key { "metadata.owner": ... }
path\\.segment     -> literal key { "path\\segment": ... }
```

On an object detail page, editable values in this flattened grid open a focused,
type-aware control when clicked. Enter saves that field immediately; Escape
closes the control without changing its value. Text, numbers, booleans, nulls,
empty objects, and empty arrays retain their JSON types unless the user
explicitly changes the type. Focused and data-only saves use guarded RFC 6902
JSON Patch operations, so unrelated concurrent data edits compose and a stale
value fails safely instead of being overwritten. `Edit data` also exposes `Add
field`, which accepts the same dotted/bracket path syntax and can create missing
object branches or append the next array item. `Edit as JSON` opens the raw
object data document directly, shows a structural change review, and turns
data-only saves into granular guarded patch operations. Read-only users get a
plain raw JSON view. Arrays are replaced atomically at their own path, and
unusually large edits fall back to a guarded whole-document replacement.

Directly editable values on object, class, and collection detail pages use the
same whole-field edit target instead of a separate pencil or Edit control. This
includes names, descriptions, collection selectors, schema validation, and JSON
schema. Opening one focuses its editor immediately, and Escape restores the
draft. Permission-gated hierarchy moves remain a separate collection operation.

On server builds with versioned schemas, the class page shows the current schema,
write enforcement, and existing-object validation state. **Edit schema** opens
**Schema → Validation → Review & test → Activate** directly in the editor.
**Check existing objects** in Validation saves the proposal and runs a real server
analysis without changing the active policy, object data, or live compliance.
Review & test shows the differences and findings; activation is always explicit.
Activation returns to the class page with links to background validation and any
computed-field rebuild. A compatible analysis can become outdated when objects
or the active schema change; refresh the analysis after a conflict.

When enforcement is off, checking a stored schema also saves an enforced snapshot
and analyzes it to find mismatches. This test never enables enforcement on the
proposal. Activation uses the separate impact result for the exact selected
policy; a schema test cannot authorize activation of a different revision.

Impact reports, aggregate counts, and revalidation require unrestricted
administrator access. Class editors can save a proposal and share its revision
link for an administrator to review. Administrator activation with pending
validation is a separate, confirmed action. Activation leaves object JSON
unchanged, queues revalidation and any dependent computed rebuild, and makes
subsequent writes use the new policy. Compliance pages list accessible objects
as valid, invalid, pending, or not required, including after migration.

Saved revision and task links can be reopened after navigation or reload. Drafts
remain unsaved until **Save revision** or **Check existing objects**. History allows an older document to be
used as the starting point for a new revision; active or retired documents are
never edited in place. Servers without the schema endpoints retain the inline
schema editor. See [compatibility](compatibility.md) for the released server target.

Escape is the console-wide safe exit for transient work. It closes the most
recently opened menu, create form, or edit mode without saving its draft; nested
modes unwind one at a time. Escape is ignored while an inline save or delete is
in progress, so leaving the interface never implies that an active request was
canceled.

## Collection hierarchy

Collections are hierarchical. The frontend shows parent/path information in
collection lists, lets users create collections under a parent, and supports
moving non-root collections to another visible parent. The root collection
cannot be moved or deleted, and collections with direct children must have those
children moved or deleted before the collection can be deleted.

Collection permission management distinguishes direct rows from effective
permissions. Direct rows are editable on the collection detail page. Effective
permissions include inherited grants from ancestor collections and are shown as
read-only context for the current principal.

Collection names are unique among siblings, not globally. UI selectors prefer
path-aware labels where the API uses collection IDs. Import overrides still use
the backend's name-based `CollectionKey`, so the frontend blocks existing
collection overrides when multiple visible collections share the selected name.
