"use client";

import Link from "next/link";
import { useState } from "react";
import { TablePagination } from "@/components/table-pagination";
import type { SchemaImpactFindingResponse } from "@/lib/api/generated/models";
import {
	schemaActualDescription,
	schemaOmissionLabels,
} from "@/lib/schema-report";

export function SchemaObjectDiagnostics({
	classId,
	findings,
}: {
	classId: number;
	findings: SchemaImpactFindingResponse[];
}) {
	const [requestedPage, setPage] = useState(0);
	const page = Math.min(
		requestedPage,
		Math.max(0, Math.ceil(findings.length / 10) - 1),
	);
	const start = page * 10;
	const visible = findings.slice(start, start + 10);
	if (!findings.length) return null;
	return (
		<section className="stack" aria-label="Object diagnostics">
			<h4>What needs fixing</h4>
			<p className="muted">
				Saved findings from the analyzed object revisions. Current object data
				may have changed. JSON Pointer array indexes start at zero.
			</p>
			<p className="muted">
				Objects {start + 1}–{start + visible.length} of {findings.length}
			</p>
			{visible.map((finding) => (
				<details className="card stack" key={finding.object_id}>
					<summary>
						Object #{finding.object_id} ·{" "}
						{finding.snapshot
							? `${finding.snapshot.diagnostics.issues.length} recorded issues`
							: "First failure only"}
					</summary>
					<Link
						href={`/objects/${classId}/${finding.object_id}`}
						prefetch={false}
					>
						Open object #{finding.object_id}
					</Link>
					{finding.snapshot ? (
						<>
							<p className="muted">
								Object revision {finding.snapshot.object_revision} · Inspected{" "}
								<time dateTime={finding.snapshot.inspected_at}>
									{finding.snapshot.inspected_at}
								</time>
							</p>
							{finding.snapshot.diagnostics.truncated ? (
								<p className="info-banner">
									More issues exist than the server retained. This is not a
									complete list of repairs.
								</p>
							) : null}
							<ol className="stack">
								{finding.snapshot.diagnostics.issues.map((issue, index) => (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: Saved issues are immutable and may be identical after redaction.
										key={`${index}:${issue.reason.keyword}:${issue.instance_path}`}
										className="stack"
									>
										<p>{issue.message}</p>
										{issue.alternative ? (
											<p className="info-banner">
												Alternative branch explanation; this is not an
												independently required repair.
											</p>
										) : null}
										<dl className="guided-flow-review-list">
											<div>
												<dt>Object location</dt>
												<dd>
													{issue.instance_path == null ? (
														"Omitted"
													) : issue.instance_path === "" ? (
														"Root of object data"
													) : (
														<code>{issue.instance_path}</code>
													)}
												</dd>
											</div>
											<div>
												<dt>Constraint</dt>
												<dd>
													{issue.reason.keyword}
													{issue.reason.schema_path != null ? (
														<>
															{" "}
															·{" "}
															<code>
																{issue.reason.schema_path || "(schema root)"}
															</code>
														</>
													) : null}
												</dd>
											</div>
											<div>
												<dt>Expected</dt>
												<dd>
													{issue.expected.status === "available" ? (
														<code>{JSON.stringify(issue.expected.value)}</code>
													) : (
														"Omitted"
													)}
												</dd>
											</div>
											<div>
												<dt>Actual type and size</dt>
												<dd>{schemaActualDescription(issue.actual)}</dd>
											</div>
										</dl>
										{issue.omissions.length ? (
											<p className="muted">
												{issue.omissions
													.map((omission) => schemaOmissionLabels[omission])
													.join("; ")}
												.
											</p>
										) : null}
									</li>
								))}
							</ol>
						</>
					) : (
						<p>
							This older finding retained only its first failure:{" "}
							{finding.reason.missing_property != null
								? `Missing required “${finding.reason.missing_property}”`
								: finding.reason.keyword}
							. Analyze again to obtain detailed diagnostics.
						</p>
					)}
				</details>
			))}
			<TablePagination
				hasNextPage={start + visible.length < findings.length}
				hasPrevPage={page > 0}
				onNextPage={() => setPage(page + 1)}
				onPrevPage={() => setPage(page - 1)}
				onFirstPage={() => setPage(0)}
				currentCount={visible.length}
				totalCount={findings.length}
			/>
		</section>
	);
}
