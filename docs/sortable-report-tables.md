# Sort tables in HTML reports

Add `data-sortable` to a table in a saved HTML export template to let readers
sort its columns. The frontend supplies the sorting controls in report pages,
stored-run pages, template-test previews, and inline export previews. No
JavaScript, script hosting, or administrator CSP changes are needed in the template.

This feature is available in frontend `v0.0.20` and newer.
Upgrade the frontend to a version containing this feature; no server API or
database upgrade is required for an already supported server.

## Make a table sortable

Use one header row inside `thead` and put the data rows inside `tbody`:

```html
<table data-sortable>
  <caption>Server inventory</caption>
  <thead>
    <tr>
      <th>Name</th>
      <th>Description</th>
      <th data-sort-type="date">Created</th>
    </tr>
  </thead>
  <tbody>
    {% for item in items %}
    <tr>
      <td>{{ item.name }}</td>
      <td>{{ item.description | default('', true) }}</td>
      <td data-sort-value="{{ item.created_at | format_datetime('iso') }}">
        {{ item.created_at | format_datetime('date') }}
      </td>
    </tr>
    {% endfor %}
  </tbody>
</table>
```

The frontend turns each sortable heading into a button. Click once to sort
ascending and again to reverse the order. Tab to a heading and use Enter or
Space for the same behavior. An arrow and `aria-sort` identify the active order.
The template's generated order is preserved until a reader clicks a heading.
Multiple tables keep independent sort orders.

## Choose how values are compared

Set `data-sort-type` on a `th`:

| Value | Behavior |
| --- | --- |
| `text` or omitted | Natural, case-insensitive text sorting using the browser's locale: `B2` before `B10`, and `host9` before `host10`. |
| `number` | Numeric comparison of plain decimal or exponent values, such as `1200`, `-2.5`, or `1e3`. |
| `date` | Chronological comparison of ISO dates (`2026-10-13`) or timestamps with seconds and an optional timezone (`2026-10-13T09:30:00Z` or `2026-10-13T11:30:00+02:00`). |
| `none` | Leave this column without a sort control. Unknown types also disable the control. |

By default, the sorter reads trimmed cell text. Add `data-sort-value` to a `td`
or body `th` when the displayed text has formatting, units, or a localized date:

```html
<td data-sort-value="1200">1.2 TB</td>
<td data-sort-value="2026-10-13T09:30:00Z">13 October 2026</td>
<td data-sort-value="">Unknown</td>
```

An explicitly empty value remains empty; it does not fall back to the displayed
text. Empty values and unparseable numeric/date values stay last in both
directions. Equal values preserve their relative order. Use one consistent unit
for numeric sort values and valid ISO dates for date columns. Date sorting uses
the timestamp's timezone, not its displayed calendar date. Hubuum timestamps
without a timezone are interpreted as UTC, independently of the browser's timezone.

If the template already sorts a column, declare that order on exactly one header:

```html
<th data-sort-type="date" aria-sort="ascending">Commissioned</th>
```

This describes the existing order; it does not sort the initial rows. The first
click then reverses that column. MiniJinja's `sort` filter compares timestamp
strings, so normalize their timezone and precision before relying on that filter
for an initial chronological order.

## Filter rows in the template

Browser sorting only reorders rows already present. Keep room exclusions,
permission-filtered data selection, and missing-value checks in the export
query or MiniJinja template. It does not fetch more objects or change a stored
export, and sorting cannot recover rows omitted by export limits.

For a custom inventory with optional `data.facts.operating_system.system`, guard
each optional parent before testing the value. This also works with the server's
strict missing-data policy:

```jinja
{% set data = item.data | default({}, true) %}
{% set facts = data.facts | default({}, true) %}
{% set operating_system = facts.operating_system | default({}, true) %}
{% set system = operating_system.system | default('', true) | trim %}
{% if system != '' %}
  {# Add the item's row here, along with any other filter conditions. #}
{% endif %}
```

See the server's [export template guide](https://hubuum.github.io/hubuum/v0.0.20/export_template_guide/)
for template context, relations, and missing-data behavior.

## Supported layouts and output

- Tables need one `thead` row containing `th` cells and at least one `tbody`.
- Every body row must have one cell per column, without `rowspan` or `colspan`.
  Nested tables and multirow headers are left unchanged.
- Multiple `tbody` sections are sorted separately, preserving their grouping.
  `tfoot` totals stay in place and may contain spanning cells.
- Headings containing links, buttons, or form controls are left unchanged.
- Unmarked tables retain their existing behavior. Sorting is not saved across
  reloads, bookmarks, or new report runs. Printing uses the current row order.

The frontend adds its sorter and disables automatic refresh redirects in HTML
served through `/reports/{template_id}`, `/reports/runs/{task_id}`, and embedded
previews. HTML is buffered for this inspection and served as UTF-8. CSV, JSON, plain text,
and the original server output remain unchanged. A direct API download contains
the original HTML without the frontend's helper. For byte-identical stored HTML,
use `/api/v1/exports/{task_id}/output`, or
`/_hubuum-bff/hubuum/api/v1/exports/{task_id}/output` for authenticated browser
requests. Saving a frontend report page includes the helper. Standalone consumers
must supply their own sorting support if needed.

## Script restrictions

Report pages and previews permit only the frontend's exact, hash-authorized
sorter. Template scripts, event handlers such as `onclick`, external JavaScript,
scripted network connections, and access to the console's origin remain blocked.
Automatic `meta refresh` redirects are disabled before rendering, even when a
browser setting or a stricter CSP prevents the trusted sorter from running. Adding
`data-sortable` does not grant a template permission to run code.

If controls are absent, check the table structure and frontend version. A
deployment proxy can impose an additional, stricter CSP that blocks the trusted
sorter too. Keep report isolation when diagnosing such a policy; enabling
arbitrary inline scripts is not required for this feature.
