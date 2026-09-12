"use client";

import Link from "next/link";
import type {
	SchemaImpactCounts,
	SchemaWorkResponse,
} from "@/lib/api/generated/models";

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
					{work.readiness === "compatible"
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
					{impact.failures.length > 0 ? (
						<>
							<h4>First reported failures</h4>
							<p className="muted">
								Up to 20 groups and five example IDs per group. Each object
								contributes its first failure; fixing it may reveal further
								issues.
							</p>
							<div className="table-wrap">
								<table>
									<thead>
										<tr>
											<th>Constraint</th>
											<th>Objects</th>
											<th>Examples</th>
										</tr>
									</thead>
									<tbody>
										{impact.failures.map((group) => (
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
													<div className="action-row">
														{group.samples.map((id) => (
															<Link
																key={id}
																href={`/objects/${work.target.class_id}/${id}`}
															>
																Object #{id}
															</Link>
														))}
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					) : null}
					{impact.ungrouped_failures > 0 ? (
						<p>
							{impact.ungrouped_failures} additional failures did not fit the
							report’s group limit.
						</p>
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
