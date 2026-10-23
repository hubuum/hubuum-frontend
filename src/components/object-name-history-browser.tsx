"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HistoryDetailsModal } from "@/components/history-details-modal";
import { SnapshotPresentation } from "@/components/history-snapshot-presentation";
import {
	HistoryStackNavigation,
	historyTime,
} from "@/components/history-stack-navigation";
import styles from "@/components/resource-history.module.css";
import {
	fetchObjectHistoryByNamePage,
	type HistoryRecord,
} from "@/lib/api/events";
import {
	historyInstant,
	isDeletedVersion,
	resourceHistoryHref,
} from "@/lib/resource-history";
import { useHistorySelection } from "@/lib/use-history-selection";

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
	const [details, setDetails] = useState<HistoryRecord | null>(null);
	const search = useSearchParams();
	const { preview, updateUrl, selectVersion } = useHistorySelection();
	const version = search.get("version");
	const at = search.get("at");
	const validSelection =
		Number.isSafeInteger(Number(version)) &&
		Number(version) > 0 &&
		(!at || historyInstant(at) !== null);
	const history = useInfiniteQuery({
		queryKey: ["object-history-by-name", classId, name],
		initialPageParam: "",
		queryFn: ({ pageParam }) =>
			fetchObjectHistoryByNamePage(classId, name ?? "", pageParam || undefined),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: name !== null,
		retry: false,
	});
	const records = useMemo(
		() =>
			Array.from(
				new Map(
					(history.data?.pages.flatMap((page) => page.items) ?? []).map(
						(record) => [record.history_id, record],
					),
				).values(),
			).sort((a, b) => b.history_id - a.history_id),
		[history.data],
	);
	const selectedLoaded =
		version === null
			? records[0]
			: records.find(
					(record) =>
						record.history_id === Number(version) &&
						(!at || record.valid_from === at),
				);
	const selected = preview ?? selectedLoaded;
	const { hasNextPage, isFetching, isError, fetchNextPage } = history;
	const needsOlderPages =
		validSelection &&
		!selectedLoaded &&
		(!records.length || records[records.length - 1].history_id > Number(version));
	// Name results span identities: recover bookmarked versions from this search,
	// without resolving an as-of snapshot against a different live object.
	useEffect(() => {
		if (
			name !== null &&
			needsOlderPages &&
			hasNextPage &&
			!isFetching &&
			!isError
		)
			void fetchNextPage();
	}, [
		name,
		needsOlderPages,
		hasNextPage,
		isFetching,
		isError,
		fetchNextPage,
	]);
	useEffect(() => {
		if (version === null && records[0])
			updateUrl(
				{ at: records[0].valid_from, version: String(records[0].history_id) },
				true,
			);
	}, [version, records, updateUrl]);
	const locating =
		name !== null &&
		needsOlderPages &&
		!isError &&
		(history.isLoading || hasNextPage);
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
					else
						updateUrl({
							name: draft,
							at: null,
							version: null,
							compare: null,
							pin: null,
							pinAt: null,
						});
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
			{locating ? <p role="status">Loading the selected snapshot…</p> : null}
			{version !== null &&
			!selected &&
			!locating &&
			!history.isLoading &&
			!history.isError ? (
				<p role="alert">
					The selected snapshot is unavailable in this name’s visible history.
				</p>
			) : null}
			{selected ? (
				<HistoryStackNavigation
					records={records}
					selected={selected}
					onSelect={selectVersion}
					showObjectIds
					loadOlder={hasNextPage ? () => void fetchNextPage() : undefined}
					loadingOlder={history.isFetchingNextPage}
				>
					<article className={styles.snapshot}>
						<header className={styles.snapshotHeading}>
							<div>
								<h2>
									<time dateTime={selected.valid_from}>
										{historyTime(selected.valid_from)} UTC
									</time>
								</h2>
								<p className="muted">
									Stored version #{selected.history_id} · {selected.op} ·{" "}
									object #{selected.id} · revision {selected.revision}
								</p>
							</div>
							<Link
								className="link-chip"
								href={resourceHistoryHref({
									type: "object",
									classId,
									objectId: selected.id,
								})}
							>
								Browse identity history
							</Link>
						</header>
						{isDeletedVersion(selected) ? (
							<p>
								This marker records the deletion of object #{selected.id}. The
								fields below show its retained stored state.
							</p>
						) : null}
						<SnapshotPresentation record={selected} />
						<button
							type="button"
							className="secondary"
							onClick={() => setDetails(selected)}
						>
							Version details and provenance
						</button>
					</article>
				</HistoryStackNavigation>
			) : records.length ? (
				<button
					type="button"
					className="secondary"
					onClick={() => selectVersion(records[0])}
				>
					Show latest visible entry
				</button>
			) : null}
			{history.isError && !selected ? (
				<button type="button" onClick={() => void history.refetch()}>
					Retry loading history
				</button>
			) : null}
			<p className="muted">
				Scroll the timeline or use its arrow keys to inspect snapshots. Browse
				that identity’s history for comparisons and restoration to the same
				object ID. A replacement with the same name is a separate identity.
			</p>
			<HistoryDetailsModal
				record={details}
				onClose={() => setDetails(null)}
				browseIdentity
			/>
		</section>
	);
}
