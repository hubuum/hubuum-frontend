import Link from "next/link";

import type { ReportTemplate } from "@/lib/api/reporting";
import {
	EXPORT_ACTION_HINTS,
	formatExportContentType,
	formatExportScope,
	formatExportTimestamp,
	getBookmarkableReportHref,
	getReportConfigurationHref,
	getReportRefreshHref,
} from "@/lib/export-workspace";

type ReportTemplateCardProps = {
	collectionLabel?: string;
	template: ReportTemplate;
};

export function ReportTemplateCard({
	collectionLabel,
	template,
}: ReportTemplateCardProps) {
	const needsObject = template.scope_kind === "related_objects";
	const reportHref = getBookmarkableReportHref(template.id);
	const refreshHref = getReportRefreshHref(template.id);
	const configureHref = getReportConfigurationHref(template.id);

	return (
		<article className="report-card">
			<div className="stack report-card-copy">
				<div className="report-card-title-row">
					<div className="stack action-card-header">
						<h4>{template.name}</h4>
						<p className="template-description">{template.description}</p>
					</div>
					<span className="status-pill status-pill--neutral report-card-format">
						{formatExportContentType(template.content_type)}
					</span>
				</div>
				<div className="preview-meta">
					<span>
						{collectionLabel ?? `Collection #${template.collection_id}`}
					</span>
					<span>{formatExportScope(template.scope_kind)}</span>
					<span>{template.default_query ? "Saved query" : "No filters"}</span>
				</div>
			</div>

			<div className="report-card-freshness">
				<div>
					<strong>
						{needsObject ? "Object required" : "Latest available result"}
					</strong>
					<small>
						{needsObject
							? "Choose the root object before viewing."
							: "Regenerates automatically when stored output expires."}
					</small>
				</div>
				<span className="template-stamp report-card-updated">
					Template updated {formatExportTimestamp(template.updated_at)}
				</span>
			</div>

			<div className="report-card-actions">
				{needsObject ? (
					<Link
						className="link-chip link-chip--primary action-hint"
						data-action-hint={EXPORT_ACTION_HINTS.chooseObject}
						href={configureHref}
					>
						Choose object
					</Link>
				) : (
					<>
						<Link
							className="link-chip link-chip--primary action-hint"
							data-action-hint={EXPORT_ACTION_HINTS.view}
							href={reportHref}
							target="_blank"
							rel="noopener noreferrer"
							prefetch={false}
						>
							View
						</Link>
						<Link
							className="link-chip action-hint"
							data-action-hint={EXPORT_ACTION_HINTS.refresh}
							href={refreshHref}
							target="_blank"
							rel="noopener noreferrer"
							prefetch={false}
						>
							Refresh now
						</Link>
					</>
				)}
				<Link
					className="link-chip action-hint"
					data-action-hint={EXPORT_ACTION_HINTS.runWithChanges}
					href={configureHref}
				>
					Run with changes
				</Link>
				<details className="report-card-more">
					<summary
						className="action-hint"
						data-action-hint={EXPORT_ACTION_HINTS.moreTemplateActions}
					>
						More
					</summary>
					<div className="report-card-more-menu">
						<Link href={`/exports/templates/${template.id}`}>Edit template</Link>
						<Link href={`/exports/templates/new?from=${template.id}`}>
							Duplicate
						</Link>
					</div>
				</details>
			</div>
		</article>
	);
}
