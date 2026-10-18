"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { HistoryDetailsModal } from "@/components/history-details-modal";
import { historyTime } from "@/components/history-stack-navigation";
import { fetchObjectHistoryByNamePage } from "@/lib/api/events";
import type { HistoryResponseHubuumObjectHistory } from "@/lib/api/generated/models";
import { isDeletedVersion } from "@/lib/resource-history";
import { updateViewQuery } from "@/lib/view-query";

export function ObjectNameHistoryBrowser({ classId }: { classId: number }) {
	const name = useSearchParams().get("name");
	return (
		<ObjectNameHistoryResults
			key={JSON.stringify([classId, name])}
			classId={classId}
			name={name}
		/>
	);
}

function ObjectNameHistoryResults({
	classId,
	name,
}: {
	classId: number;
	name: string | null;
}) {
	const [ready, setReady] = useState(false);
	useEffect(() => setReady(true), []);
	const [selected, setSelected] =
		useState<HistoryResponseHubuumObjectHistory | null>(null);
	const history = useInfiniteQuery({
		queryKey: ["object-history-by-name", classId, name],
		initialPageParam: "",
		queryFn: ({ pageParam }) =>
			fetchObjectHistoryByNamePage(classId, name ?? "", pageParam || undefined),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: name !== null,
		retry: false,
	});
	const records = Array.from(
		new Map(
			(history.data?.pages.flatMap((page) => page.items) ?? []).map(
				(record) => [record.history_id, record],
			),
		).values(),
	);
	return (
		<section className="stack" aria-label="Object history by name">
			<header className="page-header">
				<div>
					<h1>Object history by name</h1>
					<p>Historical class ID: #{classId}</p>
				</div>
				<Link className="link-chip" href={`/classes/${classId}`}>
					Back to class
				</Link>
			</header>
			<p className="muted">
				Find retained snapshots recorded under an exact, case-sensitive name in
				this class, including visible deleted and recreated objects. Versions
				recorded under other names are excluded. Results depend on your current
				history permissions and retention.
			</p>
			<form
				className="action-row"
				onSubmit={(event) => {
					event.preventDefault();
					const draft = String(
						new FormData(event.currentTarget).get("name") ?? "",
					);
					if (draft === name) void history.refetch();
					else updateViewQuery({ name: draft }, "push");
				}}
			>
				<label className="control-field">
					<span>Exact historical object name</span>
					<input
						disabled={!ready}
						name="name"
						defaultValue={name ?? ""}
						aria-describedby="history-name-help"
					/>
				</label>
				<button type="submit" disabled={!ready}>
					Search history
				</button>
			</form>
			<p className="muted" id="history-name-help">
				Spaces and numeric names are matched literally. Submit an empty field to
				search for an empty name. A live object is not required.
			</p>
			{name !== null ? (
				<p role="status" aria-label="History search results">
					{history.isLoading
						? "Loading matching snapshots…"
						: `${records.length} matching snapshots loaded for ${JSON.stringify(name)}.`}
				</p>
			) : null}
			{history.isError ? (
				<p role="alert" className="error-banner">
					{history.error.message}
				</p>
			) : null}
			{history.isSuccess && !records.length ? (
				<p className="empty-state">
					No visible retained snapshots match this name.
				</p>
			) : null}
			{records.length ? (
				<div className="table-wrap card">
					<table>
						<caption>Matching historical snapshots · Class #{classId}</caption>
						<thead>
							<tr>
								<th scope="col">Object ID</th>
								<th scope="col">Version</th>
								<th scope="col">Recorded at</th>
								<th scope="col">Operation</th>
								<th scope="col">Snapshot</th>
							</tr>
						</thead>
						<tbody>
							{records.map((record) => (
								<tr key={record.history_id}>
									<td>#{record.id}</td>
									<td>
										#{record.history_id} · revision {record.revision}
									</td>
									<td>
										<time
											dateTime={record.valid_from}
											title={record.valid_from}
										>
											{historyTime(record.valid_from)} UTC
										</time>
									</td>
									<td>{isDeletedVersion(record) ? "Deleted" : record.op}</td>
									<td>
										<button
											type="button"
											className="secondary"
											onClick={() => setSelected(record)}
											aria-label={`View snapshot #${record.history_id} for object #${record.id}`}
										>
											View snapshot
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
			{history.hasNextPage ? (
				<button
					type="button"
					className="secondary"
					disabled={history.isFetchingNextPage}
					onClick={() => void history.fetchNextPage()}
				>
					{history.isFetchingNextPage ? "Loading…" : "Load more snapshots"}
				</button>
			) : null}
			<p className="muted">
				Open a snapshot to inspect its full stored state and provenance. Browse
				that identity’s history for comparisons and restoration to the same
				object ID. A replacement with the same name is a separate identity.
			</p>
			<HistoryDetailsModal
				record={selected}
				onClose={() => setSelected(null)}
				browseIdentity
			/>
		</section>
	);
}
