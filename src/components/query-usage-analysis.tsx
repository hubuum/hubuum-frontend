"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { QueryUsagePatternForm } from "@/components/query-usage-pattern-form";
import type {
	QueryPatternObservation,
	QueryUsagePatternSchema,
	QueryUsageResponse,
} from "@/lib/api/generated/models";
import { analyzeQueryUsage, QueryUsageApiError } from "@/lib/api/query-usage";
import {
	hasQueryUsageDeclaration,
	queryUsagePatternLabel,
} from "@/lib/query-usage";

function Observations({
	observations,
}: {
	observations: QueryPatternObservation[];
}) {
	return (
		<section
			className="table-wrap"
			aria-label="Sampled query details"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: The horizontally scrollable table needs keyboard access.
			tabIndex={0}
		>
			<table>
				<caption>Sampled successful queries</caption>
				<thead>
					<tr>
						<th scope="col">Pattern</th>
						<th scope="col">Samples</th>
						<th scope="col">Total whole-query time</th>
						<th scope="col">First observed</th>
						<th scope="col">Last observed</th>
					</tr>
				</thead>
				<tbody>
					{observations.map((observation) => (
						<tr key={queryUsagePatternLabel(observation.pattern)}>
							<td>{queryUsagePatternLabel(observation.pattern)}</td>
							<td>{observation.sampled_queries.toLocaleString()}</td>
							<td>
								{(
									observation.whole_query_duration_micros / 1000
								).toLocaleString()}{" "}
								ms
							</td>
							<td>{observation.first_observed_at}</td>
							<td>{observation.last_observed_at}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}

export function QueryUsageAnalysis({
	classId,
	declarations,
	busy,
	onAdopt,
}: {
	classId: number;
	declarations: QueryUsageResponse[];
	busy: boolean;
	onAdopt: (pattern: QueryUsagePatternSchema) => void;
}) {
	const [proposed, setProposed] = useState<QueryUsagePatternSchema[]>([]);
	const analysis = useQuery({
		queryKey: ["query-usage", classId, "analysis", proposed],
		queryFn: ({ signal }) => analyzeQueryUsage(classId, proposed, signal),
		retry: false,
		refetchOnWindowFocus: false,
	});
	const report =
		analysis.isSuccess && !analysis.isFetching ? analysis.data : null;
	return (
		<section className="card stack" aria-label="Administrative analysis">
			<div className="panel-header">
				<h2>Administrative analysis</h2>
				<button
					type="button"
					className="ghost"
					disabled={analysis.isFetching || busy}
					onClick={() => void analysis.refetch()}
				>
					Refresh analysis
				</button>
			</div>
			<p className="muted">
				Review observations, native coverage, and suggestions. Analysis does not
				save declarations or prepare indexes.
			</p>
			<details>
				<summary>Analyze hypothetical patterns ({proposed.length}/32)</summary>
				<div className="stack">
					<p>
						Test patterns without saving them. Adding or removing a pattern runs
						a new analysis.
					</p>
					<QueryUsagePatternForm
						key={JSON.stringify(proposed)}
						label="Hypothetical pattern"
						submitLabel="Analyze hypothetical pattern"
						disabled={proposed.length >= 32 || analysis.isFetching || busy}
						onSubmit={(pattern) => {
							if (
								proposed.some(
									(item) =>
										queryUsagePatternLabel(item) ===
										queryUsagePatternLabel(pattern),
								)
							) {
								void analysis.refetch();
							} else setProposed([...proposed, pattern]);
						}}
					/>
					{proposed.map((pattern, index) => (
						<div className="action-row" key={queryUsagePatternLabel(pattern)}>
							<span>{queryUsagePatternLabel(pattern)}</span>
							<button
								type="button"
								className="ghost"
								disabled={analysis.isFetching || busy}
								onClick={() =>
									setProposed(
										proposed.filter((_, position) => position !== index),
									)
								}
								aria-label={`Remove hypothetical pattern ${index + 1}`}
							>
								Remove
							</button>
						</div>
					))}
				</div>
			</details>
			{analysis.isFetching ? <p role="status">Analyzing query usage…</p> : null}
			{analysis.isError ? (
				<p role="alert">
					{analysis.error instanceof QueryUsageApiError &&
					analysis.error.status === 403
						? "Analysis requires unscoped administrator access and permission to read this class."
						: analysis.error instanceof QueryUsageApiError &&
								analysis.error.status === 404
							? "Query usage analysis is unavailable for this class or server."
							: analysis.error.message}
				</p>
			) : null}
			{report ? (
				<>
					<p role="status">
						<strong>
							{report.status === "complete"
								? "Analysis complete"
								: report.status === "unavailable"
									? "Analysis unavailable"
									: "Insufficient evidence"}
						</strong>{" "}
						· Assessed {report.assessed_at}
					</p>
					{report.status === "unavailable" ? (
						<p>
							This storage backend does not provide query usage analysis.
							Declarations can still be managed.
						</p>
					) : report.status === "insufficient_evidence" ? (
						<p>
							Workload evidence or native coverage is incomplete. Missing
							observations do not establish that a declaration is unused.
						</p>
					) : null}
					{report.limitations.length ? (
						<div>
							<h3>Analysis limitations</h3>
							<ul>
								{report.limitations.map((limitation) => (
									<li key={limitation}>{limitation}</li>
								))}
							</ul>
						</div>
					) : null}
					<section className="stack" aria-label="Workload observations">
						<h3>Workload observations</h3>
						<p>
							{report.observations.settings.enabled
								? "Collection enabled"
								: "Collection disabled"}{" "}
							· Source: {report.observations.source} · Process started{" "}
							{report.observations.process_started_at} · Captured{" "}
							{report.observations.captured_at}
						</p>
						<p className="muted">
							Observations cover only the responding process and reset on
							restart. Whole-query time includes other predicates and
							authorization; it does not measure this predicate&apos;s cost or
							an index&apos;s benefit.
						</p>
						<dl className="query-usage-facts">
							<dt>Sampling</dt>
							<dd>
								Every {report.observations.settings.sample_every} logical
								requests
							</dd>
							<dt>Retention</dt>
							<dd>
								{report.observations.settings.retention_seconds.toLocaleString()}{" "}
								seconds
							</dd>
							<dt>Pattern capacity</dt>
							<dd>
								{report.observations.settings.max_patterns.toLocaleString()} per
								process / {report.observations.settings.max_patterns_per_class}{" "}
								per class
							</dd>
							<dt>Predicate budget</dt>
							<dd>
								{report.observations.settings.max_predicates_per_query} per
								query
							</dd>
							<dt>Capacity drops</dt>
							<dd>{report.observations.capacity_drops.toLocaleString()}</dd>
						</dl>
						<Link href="/admin/configuration">
							View observation configuration
						</Link>
						{report.observations.patterns.length ? (
							<Observations observations={report.observations.patterns} />
						) : (
							<p>No sampled patterns are available.</p>
						)}
					</section>
					<section className="stack" aria-label="Suggested declarations">
						<h3>Suggested declarations</h3>
						{report.suggestions.length === 0 ? (
							<p>
								{report.status === "complete"
									? "Review complete with no suggestions."
									: "No suggestions are available from this review."}
							</p>
						) : null}
						{report.suggestions.map((suggestion) => (
							<article
								className="card stack"
								key={queryUsagePatternLabel(suggestion.proposed)}
							>
								<h4>{queryUsagePatternLabel(suggestion.proposed)}</h4>
								<p>{suggestion.rationale}</p>
								<Observations observations={suggestion.observations} />
								<button
									type="button"
									disabled={
										busy ||
										declarations.length >= 32 ||
										hasQueryUsageDeclaration(declarations, suggestion.proposed)
									}
									onClick={() => onAdopt(suggestion.proposed)}
								>
									{hasQueryUsageDeclaration(declarations, suggestion.proposed)
										? "Already declared"
										: "Review and adopt"}
								</button>
							</article>
						))}
					</section>
					<section className="stack" aria-label="Native resource coverage">
						<h3>Native resource coverage</h3>
						<p className="muted">
							Preparation support does not mean an executor is running or an
							index will be used. Native scan counts can cover multiple classes
							and cannot prove that a declaration is unused.
						</p>
						{report.assessments.length === 0 ? (
							<p>No declared or hypothetical patterns were assessed.</p>
						) : null}
						{report.assessments.map((assessment) => (
							<article
								className="card stack"
								key={`${assessment.declaration_id ?? "hypothetical"}-${queryUsagePatternLabel(assessment.pattern)}`}
							>
								<h4>{queryUsagePatternLabel(assessment.pattern)}</h4>
								<p>
									{assessment.declaration_id
										? `Declaration #${assessment.declaration_id}`
										: "Hypothetical pattern"}{" "}
									· Schema: {assessment.schema_compatibility} · Preparation:{" "}
									{assessment.can_prepare ? "Supported" : "Unsupported"}
								</p>
								<p>{assessment.rationale}</p>
								{assessment.adapter_progress ? (
									<div className="stack">
										<h5>Adapter progress</h5>
										<dl className="query-usage-facts">
											<dt>Reference</dt>
											<dd>{assessment.adapter_progress.reference}</dd>
											<dt>State</dt>
											<dd>{assessment.adapter_progress.state}</dd>
											<dt>Declaration owners</dt>
											<dd>{assessment.adapter_progress.declaration_owners}</dd>
											<dt>Updated</dt>
											<dd>{assessment.adapter_progress.updated_at}</dd>
											<dt>Last diagnostic</dt>
											<dd>
												{assessment.adapter_progress.last_error ??
													"None reported"}
											</dd>
										</dl>
									</div>
								) : (
									<p>No adapter progress reported.</p>
								)}
								{assessment.resources.length === 0 ? (
									<p>No matching native resource reported.</p>
								) : (
									assessment.resources.map((resource) => (
										<div key={resource.reference}>
											<h5>{resource.reference}</h5>
											<dl className="query-usage-facts">
												<dt>Ownership</dt>
												<dd>
													{resource.ownership === "declaration_managed"
														? "Declaration managed"
														: "Independently managed"}
												</dd>
												<dt>Size</dt>
												<dd>{resource.bytes.toLocaleString()} bytes</dd>
												<dt>Native scans</dt>
												<dd>
													{resource.native_scan_count?.toLocaleString() ??
														"Not reported"}
												</dd>
												<dt>Declaration owners</dt>
												<dd>{resource.declaration_owners ?? "Not reported"}</dd>
												<dt>Cleanup eligible if withdrawn</dt>
												<dd>
													{resource.cleanup_eligible_if_removed
														? "Yes, after reconciliation"
														: "No"}
												</dd>
											</dl>
										</div>
									))
								)}
							</article>
						))}
					</section>
				</>
			) : null}
			<details>
				<summary>Preparing and cleaning up native resources</summary>
				<div className="stack">
					<p>
						An operator runs{" "}
						<code>
							hubuum-admin --reconcile-query-usage --database-role-mode split
						</code>{" "}
						with the migration credential outside the API and normal task
						workers. Schedule later passes for preparation and cleanup, then
						refresh analysis here.
					</p>
					<p>
						Withdrawing the last declaration owner makes a managed resource
						eligible for cleanup. Independently managed indexes remain under
						operator control. Preparation currently supports plain text equality
						and does not guarantee a speedup.
					</p>
					<a
						href="https://hubuum.github.io/hubuum/v0.0.19/query_usage/"
						target="_blank"
						rel="noreferrer"
					>
						Operator guide
					</a>
				</div>
			</details>
		</section>
	);
}
