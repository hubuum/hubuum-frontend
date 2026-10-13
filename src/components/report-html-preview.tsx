"use client";

import { useMemo } from "react";
import { buildReportHtml } from "@/lib/report-html";

export function ReportHtmlPreview({
	html,
	title,
}: {
	html: string;
	title: string;
}) {
	const document = useMemo(() => buildReportHtml(html), [html]);
	return (
		<iframe
			className="html-preview"
			sandbox="allow-scripts"
			srcDoc={document}
			title={title}
		/>
	);
}
