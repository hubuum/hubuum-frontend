"use client";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { JsonViewer } from "@/components/json-viewer";
import {
	fetchConfigurationHistory,
	fetchConfigurationSnapshot,
	type ConfigurationHistoryKind,
	type ConfigurationHistoryRecord,
} from "@/lib/api/configuration-history";
import { formatEventActor, formatEventInitiator } from "@/lib/event-provenance";
import { historyInstant, isDeletedVersion } from "@/lib/resource-history";
function Snapshot({ record }: { record: ConfigurationHistoryRecord }) {
	return (
		<article
			className="history-entry-card stack"
			aria-label={`History revision ${record.history_id}`}
		>
			<div className="history-entry-header">
				<strong>
					{record.op.replaceAll("_", " ")} · {record.name}
				</strong>
				<span className="template-stamp">
					History #{record.history_id} · revision {record.revision}
				</span>
			</div>
			<p className="muted">
				Valid from <time dateTime={record.valid_from}>{record.valid_from}</time>
				{record.valid_to ? (
					<>
						{" "}
						until <time dateTime={record.valid_to}>{record.valid_to}</time>
					</>
				) : (
					" (latest recorded version)"
				)}
			</p>
			<p>
				Actor:{" "}
				{record.actor_username ??
					formatEventActor({ ...record, actor_user_id: record.actor_id })}{" "}
				· Initiator: {formatEventInitiator(record)}
			</p>
			{isDeletedVersion(record) ? (
				<p>This row records deletion; it is not an active snapshot.</p>
			) : null}
			{"template" in record ? (
				<details className="export-disclosure">
					<summary>View saved content</summary>
					<pre className="response-preview export-disclosure-body">
						{record.template}
					</pre>
				</details>
			) : null}
			<details>
				<summary>All saved fields</summary>
				<JsonViewer value={record} />
			</details>
		</article>
	);
}
export function ConfigurationHistory({
	kind,
	id,
}: {
	kind: ConfigurationHistoryKind;
	id: number;
}) {
	const [draft, setDraft] = useState("");
	const [at, setAt] = useState("");
	const [error, setError] = useState<string>();
	const history = useInfiniteQuery({
		queryKey: [
			kind === "export_template"
				? "export-template-history"
				: "remote-target-history",
			id,
		],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => fetchConfigurationHistory(kind, id, pageParam),
		getNextPageParam: (last, _pages, _lastParam, params) =>
			last.nextCursor && !params.includes(last.nextCursor)
				? last.nextCursor
				: undefined,
	});
	const snapshot = useQuery({
		queryKey: ["configuration-history-as-of", kind, id, at],
		queryFn: () => fetchConfigurationSnapshot(kind, id, at),
		enabled: !!at,
		retry: false,
	});
	const rows = history.data?.pages.flatMap((page) => page.items) ?? [];
	return (
		<section className="card stack" aria-label="Saved history">
			<header className="stack action-card-header">
				<h3>Saved history</h3>
				<p className="muted">
					Inspect recorded versions and the state at a specific time. Timestamps
					retain the server's full precision.
				</p>
				<Link
					className="link-chip"
					href={`/audit?entityType=${kind}&entityId=${id}`}
				>
					Open audit activity
				</Link>
			</header>
			<form
				className="stack"
				onSubmit={(event) => {
					event.preventDefault();
					const value = draft.trim();
					if (historyInstant(value) === null) {
						setError(
							"Enter an RFC3339 timestamp with a timezone, such as 2026-10-01T12:00:00.123456Z.",
						);
						return;
					}
					setError(undefined);
					setAt(value);
					if (value === at) void snapshot.refetch();
				}}
			>
				<label className="control-field">
					<span>Snapshot timestamp</span>
					<input
						value={draft}
						placeholder="2026-10-01T12:00:00.123456Z"
						onChange={(event) => setDraft(event.target.value)}
						required
					/>
				</label>
				<div className="action-row">
					<button type="submit" disabled={snapshot.isFetching}>
						Inspect snapshot
					</button>
					{at ? (
						<button
							type="button"
							className="secondary"
							onClick={() => {
								setAt("");
								setDraft("");
								setError(undefined);
							}}
						>
							Clear snapshot
						</button>
					) : null}
				</div>
			</form>
			{error ? <p role="alert">{error}</p> : null}
			{snapshot.isFetching ? <p role="status">Loading snapshot…</p> : null}
			{at && snapshot.isError ? (
				<p role="alert">{snapshot.error.message}</p>
			) : null}
			{at && snapshot.isSuccess ? (
				<section className="stack" aria-label="Historical snapshot">
					<h4>State at {at}</h4>
					{snapshot.data ? (
						<Snapshot record={snapshot.data} />
					) : (
						<p>
							No accessible snapshot existed at this time. The resource may not
							yet have existed, may have been deleted, or may be inaccessible.
						</p>
					)}
				</section>
			) : null}
			<div className="action-row">
				<h4>Recorded versions</h4>
				<button
					type="button"
					className="secondary"
					disabled={history.isFetching}
					onClick={() => void history.refetch()}
				>
					Reload history
				</button>
			</div>
			{history.isPending ? <p role="status">Loading saved versions…</p> : null}
			{history.isError ? <p role="alert">{history.error.message}</p> : null}
			{history.isSuccess && !rows.length ? (
				<p>No saved history is available.</p>
			) : null}
			<div className="history-entry-list">
				{rows.map((record) => (
					<div className="stack" key={record.history_id}>
						<Snapshot record={record} />
						<div>
							<button
								type="button"
								className="secondary"
								onClick={() => {
									setDraft(record.valid_from);
									setAt(record.valid_from);
									setError(undefined);
								}}
							>
								Inspect state at history #{record.history_id}
							</button>
						</div>
					</div>
				))}
			</div>
			{history.hasNextPage ? (
				<button
					type="button"
					disabled={history.isFetchingNextPage}
					onClick={() => void history.fetchNextPage()}
				>
					{history.isFetchingNextPage
						? "Loading older versions…"
						: "Load older versions"}
				</button>
			) : null}
		</section>
	);
}
