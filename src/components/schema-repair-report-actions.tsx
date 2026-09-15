"use client";

import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { listReportTemplates } from "@/lib/api/reporting";
import {
	generateSchemaRepairReport,
	hasSchemaRepairReport,
	schemaRepairReportUrl,
} from "@/lib/api/schema-evolution";
import { schemaObjectUrlTemplate } from "@/lib/schema-report";

export function SchemaRepairReportActions({
	classId,
	taskId,
}: {
	classId: number;
	taskId: number;
}) {
	const queryClient = useQueryClient();
	const queryKey = ["schema", classId, "work", taskId, "html-report"];
	const stored = useQuery({
		queryKey,
		queryFn: ({ signal }) => hasSchemaRepairReport(classId, taskId, signal),
		retry: false,
		refetchOnWindowFocus: false,
	});
	const [layoutsOpen, setLayoutsOpen] = useState(false);
	const [templateId, setTemplateId] = useState("");
	const layoutId = useId();
	const layouts = useInfiniteQuery({
		queryKey: ["export-templates"],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam }) => listReportTemplates(pageParam),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: layoutsOpen,
		retry: false,
	});
	const templates =
		layouts.data?.pages
			.flatMap((page) => page.items)
			.filter((template) => template.content_type === "text/html") ?? [];
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const viewUrl = schemaRepairReportUrl(classId, taskId);
	const downloadUrl = schemaRepairReportUrl(classId, taskId, {
		download: true,
	});

	async function generate(action: "view" | "download") {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		setError(null);
		setNotice(null);
		// Open during the user gesture so asynchronous generation does not trigger popup blocking.
		const preview =
			action === "view" ? window.open("about:blank", "_blank") : null;
		if (preview) preview.opener = null;
		try {
			await generateSchemaRepairReport(classId, taskId, {
				object_url_template: schemaObjectUrlTemplate(
					classId,
					window.location.href,
				),
				template_id: templateId ? Number(templateId) : null,
			});
			queryClient.setQueryData(queryKey, true);
			if (action === "download") {
				const link = document.createElement("a");
				link.href = downloadUrl;
				document.body.append(link);
				link.click();
				link.remove();
			} else if (preview && !preview.closed) {
				preview.location.replace(viewUrl);
			} else {
				setNotice("The HTML report is ready. Use View HTML report to open it.");
			}
		} catch (failure) {
			preview?.close();
			setError(
				failure instanceof Error
					? failure.message
					: "HTML report generation failed. Please try again.",
			);
		} finally {
			pending.current = false;
			setBusy(false);
		}
	}

	return (
		<section className="stack" aria-label="HTML repair report">
			<div className="action-row">
				{stored.data ? (
					<>
						<a
							className="link-chip"
							href={viewUrl}
							target="_blank"
							rel="noreferrer"
						>
							View HTML report
						</a>
						<a className="link-chip" href={downloadUrl}>
							Download HTML report
						</a>
						<button
							type="button"
							className="ghost"
							disabled={busy || stored.isError}
							onClick={() => void generate("view")}
						>
							Refresh HTML report
						</button>
					</>
				) : (
					<>
						<button
							type="button"
							className="link-chip"
							disabled={busy || stored.isPending || stored.isError}
							onClick={() => void generate("view")}
						>
							View HTML report
						</button>
						<button
							type="button"
							className="ghost"
							disabled={busy || stored.isPending || stored.isError}
							onClick={() => void generate("download")}
						>
							Download HTML report
						</button>
					</>
				)}
			</div>
			{busy ? <p role="status">Generating HTML report…</p> : null}
			{notice ? <p role="status">{notice}</p> : null}
			{error ? (
				<p role="alert" className="error-banner">
					{error}
					{stored.data ? " The previous HTML report remains available." : ""}
				</p>
			) : null}
			{stored.isError ? (
				<div className="stack">
					<p role="alert" className="error-banner">
						{stored.error.message}
					</p>
					<button
						type="button"
						className="ghost"
						onClick={() => void stored.refetch()}
					>
						Retry HTML report access
					</button>
				</div>
			) : null}
			<p className="muted">
				{stored.data
					? "The saved HTML is a snapshot. Refresh it to include later findings or use a different layout."
					: "Creates an HTML report from saved findings, without running another analysis."}
			</p>
			<details onToggle={(event) => setLayoutsOpen(event.currentTarget.open)}>
				<summary>Report layout</summary>
				<div className="stack">
					<label htmlFor={layoutId}>Layout for the next generation</label>
					<select
						id={layoutId}
						value={templateId}
						disabled={busy}
						onChange={(event) => setTemplateId(event.target.value)}
					>
						<option value="">Default repair report</option>
						{templates.map((template) => (
							<option key={template.id} value={template.id}>
								{template.name} (#{template.id})
							</option>
						))}
					</select>
					{layouts.isFetching ? (
						<p role="status">Loading HTML layouts…</p>
					) : null}
					{layouts.isError ? (
						<p role="alert">Could not load layouts. {layouts.error.message}</p>
					) : null}
					{layouts.hasNextPage ? (
						<button
							type="button"
							className="ghost"
							disabled={layouts.isFetching}
							onClick={() => void layouts.fetchNextPage()}
						>
							Load more layouts
						</button>
					) : null}
					<p className="muted">
						Custom HTML layouts must include {"{{ report_content }}"} exactly
						once to preserve all findings. The default report works without a
						saved template.
					</p>
				</div>
			</details>
		</section>
	);
}
