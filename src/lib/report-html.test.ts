import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportHtmlPreview } from "@/components/report-html-preview";
import {
	buildReportHtml,
	enhanceReportHtmlStream,
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

	it("streams the prefix before output and preserves split UTF-8 source bytes", async () => {
		const bytes = new TextEncoder().encode("<p>Blåbær</p>");
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const source = new ReadableStream<Uint8Array>({
			start(value) {
				controller = value;
			},
		});
		const reader = enhanceReportHtmlStream(source).getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toBe(
			REPORT_HTML_PREFIX,
		);
		for (const chunk of [bytes.slice(0, 6), bytes.slice(6)]) {
			controller.enqueue(chunk);
			expect((await reader.read()).value).toEqual(chunk);
		}
		controller.close();
		expect((await reader.read()).done).toBe(true);
	});
});
