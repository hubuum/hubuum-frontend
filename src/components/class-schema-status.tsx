"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
	fetchActiveSchema,
	fetchSchemaSummary,
	startSchemaWork,
} from "@/lib/api/schema-evolution";
import { positiveSchemaId, schemaDocument } from "@/lib/schema-evolution";

export function ClassSchemaStatus({ classId }: { classId: number }) {
	const router = useRouter();
	const params = useSearchParams();
	const queryClient = useQueryClient();
	const activeQuery = useQuery({
		queryKey: ["schema", classId, "active"],
		queryFn: ({ signal }) => fetchActiveSchema(classId, signal),
	});
	const summary = useQuery({
		queryKey: ["schema", classId, "summary"],
		queryFn: ({ signal }) => fetchSchemaSummary(classId, signal),
		retry: false,
		refetchInterval: (query) =>
			query.state.data?.counts.pending ? 3000 : false,
	});
	const active = summary.data?.active ?? activeQuery.data;
	const taskId = positiveSchemaId(params.get("schema_task"));
	const rebuildId = positiveSchemaId(params.get("schema_rebuild"));
	const revalidate = useMutation({
		mutationFn: () => {
			if (!active) throw new Error("Wait for the active schema to load.");
			return startSchemaWork(classId, active.revision, "revalidation");
		},
		onSuccess: (work) => {
			queryClient.setQueryData(["schema", classId, "work", work.task_id], work);
			router.push(
				`/classes/${classId}/schema?view=report&revision=${work.target.revision}&task=${work.task_id}`,
			);
		},
	});
	return (
		<section
			className="stack class-detail-schema-panel schema-workspace"
			aria-label="Class schema"
		>
			<div className="panel-header">
				<div>
					<h2>Schema &amp; validation</h2>
					<p className="muted">Current setup for this class</p>
				</div>
				{active ? (
					<span className="status-pill">Active revision {active.revision}</span>
				) : null}
			</div>
			{activeQuery.isPending ? (
				<p role="status">Loading current schema…</p>
			) : null}
			{activeQuery.isError ? (
				<p role="alert">
					Could not load the current schema. {activeQuery.error.message}
				</p>
			) : null}
			{active ? (
				<>
					<div className="summary-grid">
						<div className="summary-pill">
							<span>Schema</span>
							<strong>
								{active.json_schema == null ? "Not configured" : "Configured"}
							</strong>
						</div>
						<div className="summary-pill">
							<span>Enforcement on writes</span>
							<strong>{active.validate_schema ? "On" : "Off"}</strong>
						</div>
					</div>
					<p>
						{active.validate_schema
							? "New and edited objects must match this schema. Existing objects may still be awaiting validation."
							: active.json_schema == null
								? "No schema is configured. Objects are not required to match a schema."
								: "The schema is stored, but object writes are not required to match it. You can check existing objects before enabling enforcement."}
					</p>
					{active.validate_schema && summary.data ? (
						<div className="stack">
							<h3>Existing objects</h3>
							<div className="summary-grid">
								{(
									[
										["Valid", summary.data.counts.valid],
										["Invalid", summary.data.counts.invalid],
										["Awaiting validation", summary.data.counts.pending],
									] as const
								).map(([label, count]) => (
									<div className="summary-pill" key={label}>
										<span>{label}</span>
										<strong>{count}</strong>
									</div>
								))}
							</div>
							{summary.data.counts.pending > 0 ? (
								<p role="status">
									Some objects have no current validation result. A check may be
									running, or revalidation may be needed.
								</p>
							) : null}
						</div>
					) : !active.validate_schema ? (
						<p className="muted">
							Live compliance is not required while enforcement is off. This
							does not mean existing objects have passed a schema check.
						</p>
					) : null}
					{active.json_schema != null ? (
						<details>
							<summary>View current schema</summary>
							<pre className="schema-document">
								{schemaDocument(active.json_schema)}
							</pre>
						</details>
					) : null}
					<div className="action-row">
						<Link className="link-chip" href={`/classes/${classId}/schema`}>
							Edit schema
						</Link>
						<Link
							className="link-chip"
							href={`/classes/${classId}/schema?step=validation`}
						>
							Change validation settings
						</Link>
						{active.json_schema != null ? (
							<Link
								className="link-chip"
								href={`/classes/${classId}/schema?step=validation`}
							>
								Check existing objects
							</Link>
						) : null}
						<Link
							className="link-chip"
							href={`/classes/${classId}/schema?view=history`}
						>
							Revision history
						</Link>
						<Link
							className="link-chip"
							href={`/classes/${classId}/schema?view=compliance`}
						>
							Object compliance
						</Link>
						{active.validate_schema && summary.data ? (
							<button
								type="button"
								className="ghost"
								disabled={revalidate.isPending}
								onClick={() => revalidate.mutate()}
							>
								{revalidate.isPending
									? "Starting validation…"
									: "Revalidate active schema"}
							</button>
						) : null}
					</div>
				</>
			) : null}
			{summary.isError ? (
				<p role="alert">
					Could not load current validation counts. {summary.error.message}
				</p>
			) : summary.isSuccess && !summary.data ? (
				<p className="muted">
					Class-wide counts and checks require unrestricted administrator
					access. You can inspect compliance for objects you can read.
				</p>
			) : null}
			{revalidate.isError ? (
				<p role="alert">{revalidate.error.message}</p>
			) : null}
			{taskId ? (
				<p className="info-banner">
					The schema change is active.{" "}
					<Link
						href={`/classes/${classId}/schema?view=report&revision=${active?.revision ?? ""}&task=${taskId}`}
					>
						Follow background validation #{taskId}
					</Link>
				</p>
			) : null}
			{rebuildId ? (
				<Link href={`/tasks/${rebuildId}`}>
					Follow computed-field rebuild #{rebuildId}
				</Link>
			) : null}
		</section>
	);
}
