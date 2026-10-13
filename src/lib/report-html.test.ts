import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportHtmlPreview } from "@/components/report-html-preview";
import {
	buildReportHtml,
	REPORT_HTML_PREFIX,
	REPORT_TABLE_SORT_HASH,
	REPORT_TABLE_SORT_SCRIPT,
} from "@/lib/report-html";

describe("trusted report HTML", () => {
	it("keeps previews opaque and escapes the complete document into srcdoc", () => {
		const html = renderToStaticMarkup(
			createElement(ReportHtmlPreview, {
				html: "<table data-sortable></table><script>untrusted()</script>",
				title: "Report preview",
			}),
		);
		expect(html).toContain('sandbox="allow-scripts"');
		expect(html).not.toContain("allow-same-origin");
		expect(html).not.toContain("<script>");
		expect(html).toContain('srcDoc="&lt;!doctype html&gt;');
	});

	it("authorizes exactly the shipped sorter, without template-dependent script bytes", () => {
		const hash = createHash("sha256")
			.update(REPORT_TABLE_SORT_SCRIPT)
			.digest("base64");
		expect(REPORT_TABLE_SORT_HASH).toBe(`sha256-${hash}`);
		expect(REPORT_TABLE_SORT_SCRIPT).not.toContain("</script");
		const html = "<!-- unfinished comment <script>untrusted()</script>";
		expect(buildReportHtml(html)).toBe(REPORT_HTML_PREFIX + html);
		expect(REPORT_HTML_PREFIX).toContain(
			`<script>${REPORT_TABLE_SORT_SCRIPT}</script>`,
		);
	});

	it.each([
		'<meta http-equiv="refresh" content="0;url=/redirect">',
		'<META HTTP-EQUIV="REF&#82;ESH" content="0;url=/redirect">',
		'<meta http-equiv=refresh http-equiv=refresh content="0;url=/redirect">',
		'<noscript><meta http-equiv=refresh content="0;url=/redirect"></noscript>',
	])(
		"disables automatic refresh without rewriting surrounding markup: %s",
		(meta) => {
			const html = `<p>Blåbær 🔒</p>${meta}<p>Inventory</p>`;
			expect(buildReportHtml(html)).toBe(
				REPORT_HTML_PREFIX +
					html.replace(/<meta/i, '$& http-equiv="x-hubuum-disabled-refresh"'),
			);
		},
	);

	it("preserves metadata examples inside comments and raw text", () => {
		const html =
			"<!-- <meta http-equiv=refresh content=0> --><style>/* <meta http-equiv=refresh content=0> */</style>";
		expect(buildReportHtml(html)).toBe(REPORT_HTML_PREFIX + html);
	});
});
