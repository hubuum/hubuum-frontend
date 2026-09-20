"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SchemaObjectDiagnostics } from "@/components/schema-object-diagnostics";
import { SchemaRepairReportActions } from "@/components/schema-repair-report-actions";
import { TablePagination } from "@/components/table-pagination";
import type {
	SchemaFailureGroup,
	SchemaImpactCounts,
	SchemaWorkResponse,
} from "@/lib/api/generated/models";
import { downloadBlob } from "@/lib/download-file";
import { schemaFailureCoverage } from "@/lib/schema-report";

const failurePageSize = 10;
const objectPageSize = 10;

function FailureObjects({
	group,
	classId,
	groupNumber,
}: {
	group: SchemaFailureGroup;
	classId: number;
	groupNumber: number;
}) {
	const [requestedPage, setPage] = useState(0);
	const page = Math.min(
		requestedPage,
		Math.max(0, Math.ceil(group.samples.length / objectPageSize) - 1),
	);
	const start = page * objectPageSize;
	const ids = group.samples.slice(start, start + objectPageSize);
	return (
		<section
			className="stack"
			aria-label={`Object IDs for failure group ${groupNumber}`}
		>
			{ids.length > 0 ? (
				<>
					<p className="muted">
						IDs {start + 1}–{start + ids.length} of {group.samples.length}{" "}
						available
					</p>
					<div className="action-row">
						{ids.map((id) => (
							<Link
								key={id}
								href={`/objects/${classId}/${id}`}
								prefetch={false}
							>
								Object #{id}
							</Link>
						))}
					</div>
				</>
			) : (
				<p className="muted">No object IDs retained.</p>
			)}
			<TablePagination
				hasNextPage={start + ids.length < group.samples.length}
				hasPrevPage={page > 0}
				onNextPage={() => setPage(page + 1)}
				onPrevPage={() => setPage(page - 1)}
				onFirstPage={() => setPage(0)}
				currentCount={ids.length}
				totalCount={group.samples.length}
			/>
		</section>
	);
}

const impactLabels: Record<keyof SchemaImpactCounts, string> = {
	newly_invalid: "Would become invalid",
	still_invalid: "Invalid under both schemas",
	newly_valid: "Would become valid",
	still_valid: "Still valid",
	newly_required_valid: "Newly enforced and valid",
	no_longer_required: "Validation no longer required",
	unchanged_not_required: "Still not required",
	uninspectable: "Could not be assessed",
};

export function SchemaWorkReport({ work }: { work: SchemaWorkResponse }) {
	const impact = work.impact;
	const coverage = useMemo(
		() => (impact ? schemaFailureCoverage(impact) : null),
		[impact],
	);
	const [requestedPage, setPage] = useState(0);
	const groupCount = impact?.failures.length ?? 0;
	const page = Math.min(
		requestedPage,
		Math.max(0, Math.ceil(groupCount / failurePageSize) - 1),
	);
	const start = page * failurePageSize;
	const groups = impact?.failures.slice(start, start + failurePageSize) ?? [];

	function downloadReport() {
		downloadBlob(
			new Blob([`${JSON.stringify(work, null, 2)}\n`], {
				type: "application/json;charset=utf-8",
			}),
			`schema-impact-class-${work.target.class_id}-revision-${work.target.revision}-task-${work.task_id}-${work.status}.json`,
		);
	}

	return (
		<article className="card stack" aria-label="Schema work report">
			<div className="panel-header">
				<h3>
					{work.kind === "impact" ? "Impact analysis" : "Object revalidation"} ·
					Revision {work.target.revision}
				</h3>
				<span className="status-pill">{work.status}</span>
			</div>
			<p role="status">
				{work.examined} objects examined ·{" "}
				{(work.elapsed_millis / 1000).toFixed(1)} seconds of processing
			</p>
			<Link href={`/tasks/${work.task_id}`}>Task #{work.task_id}</Link>
			{work.kind === "impact" ? (
				<div className="stack">
					<button type="button" className="link-chip" onClick={downloadReport}>
						{work.status === "complete"
							? "Download report (JSON)"
							: "Download partial report (JSON)"}
					</button>
					<p className="muted">
						Includes all available report data and object IDs across every page.
						Unfinished runs contain only findings saved so far.
					</p>
					{impact?.findings !== undefined ? (
						<SchemaRepairReportActions
							classId={work.target.class_id}
							taskId={work.task_id}
						/>
					) : null}
				</div>
			) : null}
			{work.status === "failed" ||
			work.status === "cancelled" ||
			work.status === "superseded" ? (
				<p className="info-banner">
					This work is {work.status}. Completed batches are retained. Start a
					new run to check the current population.
				</p>
			) : null}
			{work.kind === "impact" ? (
				<p className="info-banner">
					{work.status === "running"
						? "Checking existing objects. Wait for the analysis to finish before reviewing activation."
						: work.readiness === "compatible"
							? "Compatible with the current object population. Activation checks this again."
							: work.readiness === "incompatible"
								? "Incompatible: objects fail the proposed schema."
								: "Inconclusive: analysis is unfinished, could not inspect every object, or the schema or population changed."}
				</p>
			) : null}
			{impact ? (
				<>
					<p>
						Compared with active revision {impact.baseline.revision}. Analysis
						leaves object data and current compliance unchanged.
					</p>
					<dl className="guided-flow-review-list">
						{Object.entries(impactLabels).map(([key, label]) => (
							<div key={key}>
								<dt>{label}</dt>
								<dd>{impact.counts[key as keyof SchemaImpactCounts]}</dd>
							</div>
						))}
					</dl>
					{coverage && coverage.omitted > 0 ? (
						<p className="info-banner">
							This older report omitted {coverage.omitted} object IDs from its
							failure details. The download includes only retained IDs. Analyze
							again on an updated server for complete lists.
						</p>
					) : null}
					{impact.findings ? (
						<SchemaObjectDiagnostics
							classId={work.target.class_id}
							findings={impact.findings}
						/>
					) : null}
					{groupCount > 0 ? (
						<section className="stack" aria-label="Failure details">
							<h4>Failures by constraint</h4>
							<p className="muted">
								{coverage?.available} object IDs available in {groupCount}{" "}
								failure groups. Each object contributes its first failure;
								fixing it may reveal further issues.
							</p>
							<p className="muted">
								Groups {start + 1}–{start + groups.length} of {groupCount}
							</p>
							<div className="table-wrap">
								<table>
									<thead>
										<tr>
											<th>Constraint</th>
											<th>Objects</th>
											<th>Object IDs</th>
										</tr>
									</thead>
									<tbody>
										{groups.map((group, index) => (
											<tr key={JSON.stringify(group.reason)}>
												<td>
													{group.reason.missing_property != null
														? `Missing required “${group.reason.missing_property}”`
														: group.reason.keyword}
													{group.reason.schema_path ? (
														<div>
															<code>{group.reason.schema_path}</code>
														</div>
													) : null}
												</td>
												<td>{group.objects}</td>
												<td>
													<FailureObjects
														group={group}
														classId={work.target.class_id}
														groupNumber={start + index + 1}
													/>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<nav aria-label="Failure group pages">
								<TablePagination
									hasNextPage={start + groups.length < groupCount}
									hasPrevPage={page > 0}
									onNextPage={() => setPage(page + 1)}
									onPrevPage={() => setPage(page - 1)}
									onFirstPage={() => setPage(0)}
									currentCount={groups.length}
									totalCount={groupCount}
								/>
							</nav>
						</section>
					) : null}
				</>
			) : (
				<dl className="guided-flow-review-list">
					<div>
						<dt>Valid</dt>
						<dd>{work.valid}</dd>
					</div>
					<div>
						<dt>Invalid</dt>
						<dd>{work.invalid}</dd>
					</div>
					<div>
						<dt>Not required</dt>
						<dd>{work.not_required}</dd>
					</div>
					<div>
						<dt>Uninspectable</dt>
						<dd>{work.uninspectable}</dd>
					</div>
					<div>
						<dt>Changed during inspection</dt>
						<dd>{work.stale}</dd>
					</div>
				</dl>
			)}
		</article>
	);
}
