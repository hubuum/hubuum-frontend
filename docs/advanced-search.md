# Advanced search

Open **Search → Advanced search** to search collections, classes, or objects.
Ordinary text search remains available. Object searches can optionally select
one exact class. Choose fields, operators, values, and sorting, then press
**Run search**. Editing the builder leaves the displayed results attached to
the last executed query until you run it again.

## Boolean groups

**Match all (AND)** requires every child condition. **Match any (OR)** requires
at least one. Groups can contain other groups. **NOT** negates the complete
condition or group, including related-object conditions.

For example, to find servers in either of two collections:

```text
Search: Objects
Match all:
  Name contains "server"
  Match any:
    Collection is foo (#42)
    Collection is bar (#73)
```

This means `name contains "server" AND (collection_id = 42 OR collection_id =
73)`. Alternatively, choose **Collection → is any of** and add the two resources
as values. Their numeric IDs are sent as `[42, 73]`. An empty group or incomplete
condition cannot run. Single-child groups are normalized without changing NOT.
The expandable query preview shows the exact expression sent to the server.

Only supported fields and sort keys are offered for each target. If changing
the target makes existing conditions incompatible, those conditions remain
visible with validation errors. Remove or correct them before running. JSON
paths use dotted segments, such as `hardware.cpu.count`; choose the appropriate
text, number, boolean or date value type. Dates entered in the builder use UTC.
Ranges require two bounds; lists accept up to 50 separate values. **is missing /
null** takes no value. NOT expresses its complement.

## Resource identity and bookmarks

Pickers search accessible resources by name and show names and IDs. Class
options include collection context to distinguish duplicate names. Resource IDs
are authoritative: the same selected ID survives renames, and a restored ID
whose name is unavailable stays in the query with an explicit indication.
Selecting another similarly named resource always requires a user action.

Use **Bookmark this query**, or bookmark the address after running it. Versioned
bookmark state preserves the target, exact class, nested groups, values, sort,
page size and related-resource settings. Reopening restores the builder and
requires **Run search**; it never restores an old cursor. Unknown versions or
unsupported state produce an error with the original saved state available for
inspection. Names in pickers are resolved again against current permissions.

Bookmark URLs are limited to 4 KiB after encoding the path and query, separately
from the API request limit. Larger queries can still run, but the bookmark link
is replaced with an explanation and running clears the saved query from the
address. Refreshing then opens an empty builder. Shorten values or remove
conditions to enable bookmarking again.

Results include resource detail links and authorized class/collection context.
Cursor pagination belongs to the executed query; rerunning resets it. Exact
totals are requested for this table, while resource lookups skip totals.
Backend validation, authorization and endpoint errors are shown without
retrying a broader query.

## Related-object conditions

For object searches, **Add related-object condition** selects an exact related
class, traversal depth 1–10, and conditions on that related object's fields.
Its field rows use AND: at least one visible related object must satisfy them
all along a visible bidirectional path. With no field rows, any visible object
in the selected class can satisfy the condition. NOT means no such visible
object exists; it does not negate just one of its fields.

For example, select the Servers class, add a related-object condition for the
Sites class, and set its Name to Oslo. A hidden site or hidden connecting
relation does not make that condition true. The server is responsible for
permission-aware traversal and enforces expression and work limits.

## Inspect related resources

Enable **optional related-resource inspection**, select a related class, depth,
and maximum path count, then run the search. Use **Inspect related resources**
on an individual object result to load its neighborhood on demand.

Inspection returns **all visible related endpoints in the selected class and
depth**, with connecting path objects and relations. This is context, not proof
that a particular filter matched. For example, the Oslo predicate determines
which servers match; inspecting Sites may show Oslo and other visible sites
connected to each server. Paths expose names, IDs, context, resource links and
connecting relation IDs. Objects and relations shared by paths are deduplicated.

Each inspection is limited to 1–50 paths of at most 10 edges. A truncated result
is explicitly marked; narrow the class/depth or increase the path limit and run
again. Work-limit failures and permission changes show errors, not an apparently
complete partial expansion. Changing the executed query or root page closes
inspection and cancels pending requests. Root matches, ordering, totals and
pagination remain independent of inspection.

The optional hydration endpoint is newer than the supported Server v0.0.19
baseline. Servers without it show hydration as unavailable while ordinary and
advanced search remain usable. See [compatibility](compatibility.md#advanced-search-capabilities)
for the request contract and capability boundary.
