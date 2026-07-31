import Link from "next/link";

import type { ReportTemplate } from "@/lib/api/reporting";
import {
	describeLatestReportResult,
	describeSavedReportQuery,
	EXPORT_ACTION_HINTS,
	formatExportContentType,
	formatExportScope,
	formatExportTimestamp,
	getBookmarkableReportHref,
	getReportConfigurationHref,
	getReportRefreshHref,
} from "@/lib/export-workspace";
import type { ReportResultStatus } from "@/lib/report-result-status";

type ReportTemplateCardProps = {
	classLabel?: string;
	collectionLabel?: string;
	latestResultError?: boolean;
	latestResultLoading?: boolean;
	latestResultStatus?: ReportResultStatus | null;
	onEditDefaultQuery: (template: ReportTemplate) => void;
	template: ReportTemplate;
};

export function ReportTemplateCard({
	classLabel,
	collectionLabel,
	latestResultError = false,
	latestResultLoading = false,
	latestResultStatus,
	onEditDefaultQuery,
	template,
}: ReportTemplateCardProps) {
	const needsObject = template.scope_kind === "related_objects";
	const reportHref = getBookmarkableReportHref(template.id);
	const refreshHref = getReportRefreshHref(template.id);
	const configureHref = getReportConfigurationHref(template.id);
	const latestResult = describeLatestReportResult({
		error: latestResultError,
		loading: latestResultLoading,
		needsObject,
		status: latestResultStatus,
	});
	const savedQuery = describeSavedReportQuery(template.default_query);
	const templateClassLabel =
		template.scope_kind === "objects_in_class" && template.class_id != null
			? (classLabel ?? `Class #${template.class_id}`)
			: null;

	return (
		<article className="report-card">
			<div className="stack report-card-copy">
				<div className="report-card-title-row">
					<div className="stack report-card-heading">
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
					{templateClassLabel ? <span>Class: {templateClassLabel}</span> : null}
					<span
						className="report-card-query-meta action-hint"
						data-action-hint={savedQuery.hint}
						title={savedQuery.hint}
					>
						{savedQuery.label}
					</span>
					<span
						className="report-card-result-meta action-hint"
						data-action-hint={latestResult.hint}
						title={latestResult.hint}
					>
						{latestResult.label}
					</span>
					<span className="report-card-template-meta">
						Template: {formatExportTimestamp(template.updated_at)}
					</span>
				</div>
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
						<button
							type="button"
							onClick={(event) => {
								event.currentTarget.closest("details")?.removeAttribute("open");
								onEditDefaultQuery(template);
							}}
						>
							Edit default query
						</button>
						<Link href={`/exports/templates/${template.id}`}>
							Edit template
						</Link>
						<Link href={`/exports/templates/new?from=${template.id}`}>
							Duplicate
						</Link>
					</div>
				</details>
			</div>
		</article>
	);
}
