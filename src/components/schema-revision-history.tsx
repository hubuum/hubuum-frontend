"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
	fetchSchemaRevisions,
	SCHEMA_PAGE_SIZE,
} from "@/lib/api/schema-evolution";

export function SchemaRevisionHistory({ classId }: { classId: number }) {
	const query = useInfiniteQuery({
		queryKey: ["schema", classId, "history"],
		initialPageParam: 0,
		queryFn: ({ pageParam, signal }) =>
			fetchSchemaRevisions(classId, pageParam, signal),
		getNextPageParam: (page) =>
			page.length === SCHEMA_PAGE_SIZE ? page.at(-1)?.revision : undefined,
	});
	return (
		<section className="card stack" aria-label="Schema revision history">
			<h2>Revision history</h2>
			<p className="muted">
				Saved documents are immutable. Open a revision to inspect it or use it
				as the starting point for a new proposal.
			</p>
			{query.isPending ? <p role="status">Loading revisions…</p> : null}
			{query.isError ? (
				<p role="alert" className="error-banner">
					{query.error.message}
				</p>
			) : null}
			<div className="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Revision</th>
							<th>Status</th>
							<th>Validation</th>
							<th>Created</th>
							<th>Activated</th>
						</tr>
					</thead>
					<tbody>
						{query.data?.pages.flat().map((revision) => (
							<tr key={revision.revision}>
								<td>
									<Link
										href={`/classes/${classId}/schema?revision=${revision.revision}`}
									>
										Revision {revision.revision}
									</Link>
								</td>
								<td>{revision.status}</td>
								<td>
									{revision.validate_schema ? "Enforced" : "Not enforced"}
								</td>
								<td>{new Date(revision.created_at).toLocaleString()}</td>
								<td>
									{revision.activated_at
										? new Date(revision.activated_at).toLocaleString()
										: "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{query.hasNextPage ? (
				<button
					type="button"
					disabled={query.isFetching}
					onClick={() => void query.fetchNextPage()}
				>
					{query.isFetching ? "Loading…" : "Load more revisions"}
				</button>
			) : null}
		</section>
	);
}
