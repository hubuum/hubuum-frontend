"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { TablePagination } from "@/components/table-pagination";
import { fetchTokenActivity } from "@/lib/api/token-activity";
import { formatTokenTimestamp } from "@/lib/token-lifecycle";

function sourceMethod(method: string): string {
	switch (method) {
		case "connection_peer":
			return "Connection peer";
		case "trusted_forwarded":
			return "Trusted forwarded address";
		case "unavailable":
			return "Unavailable";
		default:
			return method;
	}
}

export function TokenActivity({
	principalId,
	tokenId,
}: {
	principalId: number;
	tokenId: number;
}) {
	const [offsets, setOffsets] = useState([0]);
	const offset = offsets[offsets.length - 1];
	const activityQuery = useQuery({
		queryKey: ["token-activity", principalId, tokenId, offset],
		queryFn: ({ signal }) =>
			fetchTokenActivity(principalId, tokenId, offset, signal),
		staleTime: 0,
		gcTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const activity = activityQuery.isError ? undefined : activityQuery.data;
	const creation = activity?.creation;
	const nextOffset = activity?.next_offset;

	return (
		<section
			className="stack token-detail-scope"
			aria-label="Credential activity"
		>
			<div className="token-detail-section-header">
				<h4>Credential activity</h4>
				<button
					type="button"
					className="ghost"
					disabled={activityQuery.isFetching}
					onClick={() => void activityQuery.refetch()}
				>
					{activityQuery.isError ? "Retry activity" : "Refresh activity"}
				</button>
			</div>
			{activityQuery.isFetching ? (
				<p role="status">Loading credential activity…</p>
			) : null}
			{activityQuery.isError ? (
				<p className="error-banner" role="alert">
					{activityQuery.error.message}
				</p>
			) : null}
			{activity ? (
				<>
					{activity.session_id ? (
						<div className="stack">
							<p className="muted">
								Creation and recent sources are shared across this
								session&apos;s rotating access tokens.
							</p>
							<dl className="event-detail-grid">
								<div>
									<dt>Session family</dt>
									<dd>{activity.session_id}</dd>
								</div>
							</dl>
						</div>
					) : null}
					<h5>Creation provenance</h5>
					{creation ? (
						<dl className="event-detail-grid">
							<div>
								<dt>Issued by</dt>
								<dd>
									{creation.issuer_id == null
										? "Unknown"
										: `Principal #${creation.issuer_id}`}
								</dd>
							</div>
							<div>
								<dt>Issuance method</dt>
								<dd>{creation.issuance_method}</dd>
							</div>
							<div>
								<dt>Created</dt>
								<dd>{formatTokenTimestamp(creation.issued_at)}</dd>
							</div>
							<div>
								<dt>Creation address</dt>
								<dd>{creation.address ?? "Unavailable"}</dd>
							</div>
							<div>
								<dt>Address resolution</dt>
								<dd>{sourceMethod(creation.address_method)}</dd>
							</div>
						</dl>
					) : (
						<p className="muted">
							Creation provenance was not recorded for this credential.
						</p>
					)}
					<h5>Collection coverage</h5>
					<dl className="event-detail-grid">
						<div>
							<dt>Source collection</dt>
							<dd>{activity.collection_enabled ? "Enabled" : "Disabled"}</dd>
						</div>
						<div>
							<dt>Retention window</dt>
							<dd>{activity.retention_days} days</dd>
						</div>
						<div>
							<dt>Source cap</dt>
							<dd>{activity.source_cap} distinct sources</dd>
						</div>
						<div>
							<dt>Recorded sources</dt>
							<dd>{activity.total}</dd>
						</div>
					</dl>
					{!activity.collection_enabled ? (
						<p className="muted">
							Collection is disabled. Existing evidence remains until it ages
							out; new source observations and creation addresses are not
							recorded.
						</p>
					) : null}
					{activity.best_effort ? (
						<p className="muted">
							Activity is collected on a best-effort basis and may be
							incomplete.
						</p>
					) : null}
					{activity.overflow_since ? (
						<p className="error-banner">
							At least one source was omitted after reaching the source cap,
							since {formatTokenTimestamp(activity.overflow_since)}. This
							history is incomplete.
						</p>
					) : null}
					<h5>Recent sources</h5>
					<p className="muted">
						Sources record successful credential validation, even when an
						operation is denied or fails. A connection peer may be a proxy or
						BFF, rather than the browser&apos;s address.
					</p>
					{activity.sources.length ? (
						<section
							className="table-wrap"
							aria-label="Recent sources table"
							// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need keyboard access.
							tabIndex={0}
							onKeyDownCapture={(event) => {
								// Arrow keys scroll this region instead of navigating tokens.
								if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
									event.stopPropagation();
								}
							}}
						>
							<table aria-label="Recent credential sources">
								<thead>
									<tr>
										<th scope="col">Address</th>
										<th scope="col">Resolution</th>
										<th scope="col">First seen</th>
										<th scope="col">Last seen</th>
									</tr>
								</thead>
								<tbody>
									{activity.sources.map((source) => (
										<tr key={`${source.address_method}:${source.address}`}>
											<td>{source.address ?? "Unavailable"}</td>
											<td>{sourceMethod(source.address_method)}</td>
											<td>{formatTokenTimestamp(source.first_seen)}</td>
											<td>{formatTokenTimestamp(source.last_seen)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					) : (
						<p className="muted">
							No recorded sources on this page. This does not establish that the
							credential was unused.
						</p>
					)}
				</>
			) : null}
			<TablePagination
				hasNextPage={nextOffset != null}
				hasPrevPage={offsets.length > 1}
				onNextPage={() => {
					if (nextOffset != null) setOffsets([...offsets, nextOffset]);
				}}
				onPrevPage={() => setOffsets(offsets.slice(0, -1))}
				onFirstPage={() => setOffsets([0])}
				currentCount={activity?.sources.length ?? 0}
				totalCount={activity?.total}
				busy={activityQuery.isFetching}
			/>
		</section>
	);
}
