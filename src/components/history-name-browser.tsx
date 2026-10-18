"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuditMatchControl } from "@/components/audit-match-control";
import { fetchEventsPage } from "@/lib/api/events";
import {
	groupHistoryEvents,
	type HistoryScope,
	namedHistoryHref,
	objectNameHistoryHref,
} from "@/lib/resource-history";
import { updateViewQuery } from "@/lib/view-query";

export function HistoryNameBrowser({
	scope,
	name,
}: {
	scope: HistoryScope;
	name?: string;
}) {
	const search = useSearchParams();
	const router = useRouter();
	const mode = search.get("historyMatch") === "name" ? "name" : "id";
	const recordedName = search.get("historyName") ?? "";
	const [draft, setDraft] = useState(recordedName || name || "");
	const discovery = useInfiniteQuery({
		queryKey: ["history-name-discovery", scope.type, recordedName],
		initialPageParam: "",
		queryFn: ({ pageParam }) =>
			fetchEventsPage({
				entity_type: scope.type,
				entity_name: recordedName,
				cursor: pageParam || undefined,
				limit: 50,
				include_total: false,
			}),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: mode === "name" && Boolean(recordedName.trim()),
		retry: false,
	});
	const groups = groupHistoryEvents(
		discovery.data?.pages.flatMap((page) => page.items) ?? [],
		scope,
	);
	const selectedId = scope.type === "object" ? scope.objectId : scope.classId;
	return (
		<section className="stack" aria-label="History scope">
			<AuditMatchControl
				mode={mode}
				onChange={(mode) => {
					const value = recordedName || name || "";
					if (mode === "name" && scope.type === "object") {
						router.push(objectNameHistoryHref(scope.classId, value));
						return;
					}
					setDraft(value);
					updateViewQuery(
						{
							historyMatch: mode === "name" ? mode : null,
							historyName: mode === "name" ? value : null,
						},
						"push",
					);
				}}
			/>
			{mode === "name" ? (
				<>
					<form
						className="action-row"
						onSubmit={(event) => {
							event.preventDefault();
							if (draft.trim()) updateViewQuery({ historyName: draft }, "push");
						}}
					>
						<label className="control-field">
							<span>Exact recorded name</span>
							<input
								required
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
							/>
						</label>
						<button type="submit">Find matching IDs</button>
					</form>
					{scope.type === "object" ? (
						<Link href={objectNameHistoryHref(scope.classId, recordedName)}>
							Search snapshots by name within class #{scope.classId}
						</Link>
					) : null}
					<p className="muted">
						Matching IDs come from visible, retained audit events across all
						collections. Load more to discover older matches. Names are recorded
						at event time; events under other names are excluded. Each ID opens
						its own full visible snapshot history.
					</p>
					{recordedName ? <p>IDs recorded as “{recordedName}”</p> : null}
					{discovery.isLoading ? (
						<p role="status">Finding matching IDs…</p>
					) : null}
					{discovery.isError ? (
						<p role="alert">
							Could not discover matching IDs. {discovery.error.message}
						</p>
					) : null}
					{groups.length ? (
						<ul
							className="history-name-groups"
							aria-label="Matching history IDs"
						>
							{groups.map((group) => (
								<li key={group.id}>
									{group.scope ? (
										<Link
											className="link-chip"
											aria-current={
												group.id === selectedId ? "page" : undefined
											}
											href={namedHistoryHref(group.scope, recordedName)}
										>
											{scope.type === "object" ? "Object" : "Class"} #{group.id}
											{group.scope.type === "object"
												? ` · Class #${group.scope.classId}`
												: ""}
											{group.id === selectedId ? " · selected" : ""}
										</Link>
									) : (
										<span>
											Object #{group.id} · Class ID unavailable in loaded events
										</span>
									)}
									<span className="muted">
										{group.eventCount} matching events loaded
									</span>
								</li>
							))}
						</ul>
					) : discovery.isSuccess ? (
						<p role="status">No matching IDs found in the loaded events.</p>
					) : null}
					{discovery.hasNextPage ? (
						<button
							type="button"
							className="secondary"
							disabled={discovery.isFetchingNextPage}
							onClick={() => void discovery.fetchNextPage()}
						>
							{discovery.isFetchingNextPage
								? "Loading…"
								: "Load more matching events"}
						</button>
					) : null}
				</>
			) : null}
			<p>
				Browsing {scope.type === "object" ? "object" : "class"} #{selectedId}.
				Comparisons and restores apply only to this ID.
			</p>
		</section>
	);
}
