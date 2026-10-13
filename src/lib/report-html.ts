import { type DefaultTreeAdapterTypes, parse } from "parse5";

// Keep this source literal: the CSP hash must cover the exact bytes sent to the
// browser, independently of server/client bundling. The hash is checked in tests.
export const REPORT_TABLE_SORT_SCRIPT = String.raw`(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const collator = new Intl.Collator(undefined, {
      numeric: true, sensitivity: "base"
    });
    for (const table of document.querySelectorAll("table[data-sortable]")) {
      const head = table.tHead;
      if (!head || head.rows.length !== 1 || !table.tBodies.length || table.querySelector("table")) continue;
      const headers = Array.from(head.rows[0].cells);
      if (!headers.length || headers.some(cell => cell.tagName !== "TH" || cell.colSpan !== 1 || cell.rowSpan !== 1)) continue;
      const bodies = Array.from(table.tBodies);
      if (bodies.some(body => Array.from(body.rows).some(row =>
        row.cells.length !== headers.length || Array.from(row.cells).some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1)
      ))) continue;

      const controls = [];
      let current = headers.findIndex(header => ["ascending", "descending"].includes(header.getAttribute("aria-sort")));
      let ascending = current < 0 || headers[current].getAttribute("aria-sort") === "ascending";
      const update = () => {
        headers.forEach((header, index) => {
          if (index === current) header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
          else header.removeAttribute("aria-sort");
        });
        for (const { button, arrow, index } of controls) {
          arrow.textContent = index === current ? (ascending ? " ▲" : " ▼") : " ↕";
          button.title = "Sort " + (index === current && ascending ? "descending" : "ascending");
        }
      };
      const value = (cell, type) => {
        const raw = (cell.getAttribute("data-sort-value") ?? cell.textContent).trim();
        if (!raw) return null;
        if (type === "text") return raw;
        if (type === "date" && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw)) return null;
        if (type === "number" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return null;
        let normalized = raw;
        if (type === "date") {
          const day = Date.parse(raw.slice(0, 10));
          if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== raw.slice(0, 10)) return null;
          // Hubuum's timezone-free ISO timestamps represent UTC, never browser-local time.
          if (raw.length > 10 && !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) normalized += "Z";
        }
        const parsed = type === "date" ? Date.parse(normalized) : Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      };
      headers.forEach((header, index) => {
        const type = header.getAttribute("data-sort-type") || "text";
        if (!["text", "number", "date"].includes(type) || header.querySelector("a, button, input, select, textarea")) return;
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-hubuum-sort-button", "");
        button.append(...header.childNodes);
        if (!button.textContent.trim()) button.textContent = "Column " + (index + 1);
        const arrow = document.createElement("span");
        arrow.setAttribute("aria-hidden", "true");
        button.append(arrow);
        header.append(button);
        header.scope = "col";
        controls.push({ button, arrow, index });
        button.addEventListener("click", () => {
          ascending = current === index ? !ascending : true;
          current = index;
          for (const body of bodies) {
            const rows = Array.from(body.rows, row => ({ row, key: value(row.cells[index], type) }));
            rows.sort((a, b) => {
              // Missing and invalid keys stay last in both directions; ties stay stable.
              if (a.key === null) return b.key === null ? 0 : 1;
              if (b.key === null) return -1;
              const order = type === "text" ? collator.compare(a.key, b.key) : a.key - b.key;
              return ascending ? order : -order;
            });
            const fragment = document.createDocumentFragment();
            for (const { row } of rows) fragment.append(row);
            body.append(fragment);
          }
          update();
        });
      });
      update();
    }
  }, { once: true });
})();`;

export const REPORT_TABLE_SORT_HASH =
	"sha256-DWljAL/zpDaEHQxklOFDV6ywL1AnqPL9xdx0PwnXAoQ=";

// Also used as a meta policy in srcdoc previews. Sandbox and frame-ancestors
// belong in the iframe attribute / response header, not a meta element.
export const REPORT_HTML_CONTENT_POLICY = `default-src 'none'; script-src '${REPORT_TABLE_SORT_HASH}'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'`;
export const SORTABLE_REPORT_SANDBOX_POLICY = `sandbox allow-scripts; ${REPORT_HTML_CONTENT_POLICY}; frame-ancestors 'none'`;

// Prepend trusted content before any template markup can change parsing context.
// The leading doctype keeps both full documents and HTML fragments in standards mode.
// After the helper registers its listener, forbid further scripts. Hash sources
// alone also permit external requests carrying matching integrity metadata.
export const REPORT_HTML_PREFIX = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${REPORT_HTML_CONTENT_POLICY}"><style>
table[data-sortable] button[data-hubuum-sort-button] { background: transparent; border: 0; color: inherit; cursor: pointer; font: inherit; font-weight: inherit; padding: .25em; text-align: inherit; }
table[data-sortable] button[data-hubuum-sort-button]:hover { text-decoration: underline; }
table[data-sortable] button[data-hubuum-sort-button]:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media print { table[data-sortable] button[data-hubuum-sort-button] span[aria-hidden] { display: none; } }
</style><script>${REPORT_TABLE_SORT_SCRIPT}</script><meta http-equiv="Content-Security-Policy" content="script-src 'none'">`;

export function buildReportHtml(html: string): string {
	const source = REPORT_HTML_PREFIX + html;
	// HTML attribute names cannot contain character references.
	if (!html.toLowerCase().includes("http-equiv")) return source;
	const insertions = new Set<number>();
	// allow-scripts also enables declarative redirects. Disable them before the
	// browser sees the document, even when CSP or browser settings block our helper.
	// Both parsing modes matter because noscript can contain active metadata.
	for (const scriptingEnabled of [true, false]) {
		const nodes: DefaultTreeAdapterTypes.Node[] = [
			parse(source, { scriptingEnabled, sourceCodeLocationInfo: true }),
		];
		while (nodes.length) {
			const node = nodes.pop();
			if (!node) continue;
			if ("childNodes" in node) {
				for (const child of node.childNodes) nodes.push(child);
			}
			if ("content" in node) nodes.push(node.content);
			if (
				"tagName" in node &&
				node.tagName === "meta" &&
				node.attrs.some(
					(attribute) =>
						attribute.name === "http-equiv" &&
						attribute.value.trim().toLowerCase() === "refresh",
				)
			) {
				const start = node.sourceCodeLocation?.startOffset;
				if (start !== undefined) insertions.add(start + "<meta".length);
			}
		}
	}
	const parts: string[] = [];
	let position = 0;
	for (const offset of [...insertions].sort((a, b) => a - b)) {
		parts.push(source.slice(position, offset));
		// The first attribute wins, including when the input has duplicate attributes.
		// Inserting instead of deleting markup preserves its parsing context.
		parts.push(' http-equiv="x-hubuum-disabled-refresh"');
		position = offset;
	}
	parts.push(source.slice(position));
	return parts.join("");
}
