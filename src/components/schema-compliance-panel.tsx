"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { ComplianceStatus } from "@/lib/api/generated/models";
import { fetchSchemaCompliance } from "@/lib/api/schema-evolution";

export function SchemaCompliancePanel({ classId }: { classId: number }) {
	const [status, setStatus] = useState<ComplianceStatus | "">("");
	const query = useInfiniteQuery({
		queryKey: ["schema", classId, "compliance", status],
		initialPageParam: 0,
		queryFn: ({ pageParam, signal }) =>
			fetchSchemaCompliance(classId, pageParam, status || undefined, signal),
		getNextPageParam: (page) => page.next_after ?? undefined,
	});
	const items = query.data?.pages.flatMap((page) => page.items) ?? [];
	return (
		<section className="card stack" aria-label="Object compliance">
			<h2>Object compliance</h2>
			<p className="muted">
				Current status under the active schema. Only objects you can read are
				shown. Invalid objects remain readable; changes must satisfy the active
				schema.
			</p>
			<label className="control-field">
				<span>Compliance status</span>
				<select
					value={status}
					onChange={(event) =>
						setStatus(event.target.value as ComplianceStatus | "")
					}
				>
					<option value="">All statuses</option>
					<option value="invalid">Invalid</option>
					<option value="pending">Pending</option>
					<option value="valid">Valid</option>
					<option value="not_required">Not required</option>
				</select>
			</label>
			<button
				type="button"
				className="ghost"
				disabled={query.isFetching}
				onClick={() => void query.refetch()}
			>
				Refresh compliance
			</button>
			{query.isError ? (
				<p role="alert" className="error-banner">
					{query.error.message}
				</p>
			) : null}
			{query.isPending ? <p role="status">Loading compliance…</p> : null}
			{items.length > 0 ? (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Object</th>
								<th>Status</th>
								<th>Active schema</th>
								<th>Last evidence</th>
							</tr>
						</thead>
						<tbody>
							{items.map((item) => (
								<tr key={item.object_id}>
									<td>
										<Link href={`/objects/${classId}/${item.object_id}`}>
											Object #{item.object_id}
										</Link>
									</td>
									<td>{item.status.replaceAll("_", " ")}</td>
									<td>Revision {item.active_schema.revision}</td>
									<td>
										{item.evidence ? (
											<>
												Revision {item.evidence.schema.revision} ·{" "}
												{new Date(item.evidence.validated_at).toLocaleString()}
												{item.status === "pending" ? " (outdated)" : ""}
											</>
										) : (
											"No evidence yet"
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : query.isSuccess ? (
				<p>No visible objects in the loaded pages.</p>
			) : null}
			{query.hasNextPage ? (
				<button
					type="button"
					disabled={query.isFetching}
					onClick={() => void query.fetchNextPage()}
				>
					{query.isFetching ? "Loading…" : "Load more objects"}
				</button>
			) : null}
		</section>
	);
}
