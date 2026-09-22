"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { TablePagination } from "@/components/table-pagination";
import type {
	SchemaImpactFindingResponse,
	SchemaIssue,
} from "@/lib/api/generated/models";
import {
	consolidateSchemaIssues,
	type SchemaDiagnosticGroup,
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
	const [view, setView] = useState("errors");
	const id = useId();
	if (!findings.length) return null;
	return (
		<section className="stack" aria-label="Object diagnostics">
			<h4>What needs fixing</h4>
			<label htmlFor={id}>View findings</label>
			<select
				id={id}
				value={view}
				onChange={(event) => setView(event.target.value)}
			>
				<option value="errors">By error</option>
				<option value="objects">By object</option>
			</select>
			{view === "errors" ? (
				<ConsolidatedDiagnostics classId={classId} findings={findings} />
			) : (
				<ObjectDiagnosticsList classId={classId} findings={findings} />
			)}
		</section>
	);
}

function ConsolidatedDiagnostics({
	classId,
	findings,
}: {
	classId: number;
	findings: SchemaImpactFindingResponse[];
}) {
	const groups = useMemo(() => consolidateSchemaIssues(findings), [findings]);
	const [requestedPage, setPage] = useState(0);
	const page = Math.min(
		requestedPage,
		Math.max(0, Math.ceil(groups.length / 10) - 1),
	);
	const start = page * 10;
	const visible = groups.slice(start, start + 10);
	return (
		<div className="stack">
			<p className="muted">
				Identical recorded errors are shown once. An object can appear under
				several errors. Saved revisions may differ from current data; JSON
				Pointer array indexes start at zero.
			</p>
			<p className="muted">
				{groups.length} distinct errors across {findings.length} objects ·
				Errors {start + 1}–{start + visible.length}
			</p>
			{visible.map((group, index) => (
				<details className="card stack" key={group.id}>
					<summary>
						Error {start + index + 1} · {group.objects.length}{" "}
						{group.objects.length === 1 ? "object" : "objects"} ·{" "}
						{group.issue?.message ??
							(group.objects[0].finding.snapshot
								? "No detailed issues retained"
								: "First failure only")}
					</summary>
					{group.issue ? (
						<SchemaIssueDetails issue={group.issue} />
					) : (
						<p>
							This finding retained only its first failure:{" "}
							{group.objects[0].finding.reason.missing_property != null
								? `Missing required “${group.objects[0].finding.reason.missing_property}”`
								: group.objects[0].finding.reason.keyword}
							. Analyze again to obtain detailed diagnostics.
						</p>
					)}
					<GroupObjects
						classId={classId}
						group={group}
						number={start + index + 1}
					/>
				</details>
			))}
			<nav aria-label="Distinct error pages">
				<TablePagination
					hasNextPage={start + visible.length < groups.length}
					hasPrevPage={page > 0}
					onNextPage={() => setPage(page + 1)}
					onPrevPage={() => setPage(page - 1)}
					onFirstPage={() => setPage(0)}
					currentCount={visible.length}
					totalCount={groups.length}
				/>
			</nav>
		</div>
	);
}

function GroupObjects({
	classId,
	group,
	number,
}: {
	classId: number;
	group: SchemaDiagnosticGroup;
	number: number;
}) {
	const [requestedPage, setPage] = useState(0);
	const page = Math.min(
		requestedPage,
		Math.max(0, Math.ceil(group.objects.length / 10) - 1),
	);
	const start = page * 10;
	const visible = group.objects.slice(start, start + 10);
	return (
		<section className="stack" aria-label={`Objects with error ${number}`}>
			<h5>Affected objects</h5>
			<p className="muted">
				Objects {start + 1}–{start + visible.length} of {group.objects.length}
			</p>
			<ul className="stack">
				{visible.map(({ finding, occurrences }) => (
					<li key={finding.object_id}>
						<Link
							href={`/objects/${classId}/${finding.object_id}`}
							prefetch={false}
						>
							Open object #{finding.object_id}
						</Link>
						{occurrences > 1 ? (
							<span> · {occurrences} recorded occurrences</span>
						) : null}
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
										More issues exist than the server retained for this object.
										This is not a complete list of repairs.
									</p>
								) : null}
							</>
						) : (
							<p className="muted">
								Inspected revision and time were not retained.
							</p>
						)}
					</li>
				))}
			</ul>
			<TablePagination
				hasNextPage={start + visible.length < group.objects.length}
				hasPrevPage={page > 0}
				onNextPage={() => setPage(page + 1)}
				onPrevPage={() => setPage(page - 1)}
				onFirstPage={() => setPage(0)}
				currentCount={visible.length}
				totalCount={group.objects.length}
			/>
		</section>
	);
}

function ObjectDiagnosticsList({
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
		<div className="stack">
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
										<SchemaIssueDetails issue={issue} />
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
		</div>
	);
}

function SchemaIssueDetails({ issue }: { issue: SchemaIssue }) {
	return (
		<>
			<p>{issue.message}</p>
			{issue.alternative ? (
				<p className="info-banner">
					Alternative branch explanation; this is not an independently required
					repair.
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
								· <code>{issue.reason.schema_path || "(schema root)"}</code>
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
		</>
	);
}
