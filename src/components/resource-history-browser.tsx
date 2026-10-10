"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { HistoryComparison } from "@/components/history-comparison";
import {
	HistoryStackNavigation,
	historyTime,
} from "@/components/history-stack-navigation";
import { JsonViewer } from "@/components/json-viewer";
import { ObjectHistoryRestore } from "@/components/object-history-restore";
import {
	fetchResourceHistoryAsOf,
	fetchResourceHistoryPage,
	type HistoryRecord,
} from "@/lib/api/events";
import {
	fetchHistoryLiveResource,
	type LiveHistoryResource,
} from "@/lib/api/resource-history";
import { toObjectDataJsonPointer } from "@/lib/api/object-data-patch";
import {
	formatEventActor,
	formatEventInitiator,
	getProvenanceTaskId,
} from "@/lib/event-provenance";
import { flattenObjectPropertyEntries } from "@/lib/object-property-entries";
import {
	compareSnapshots,
	historyInstant,
	isDeletedVersion,
	resourceHref,
	snapshotFields,
	versionContains,
	type HistoryScope,
} from "@/lib/resource-history";
import styles from "@/components/resource-history.module.css";

function SnapshotPresentation({
	record,
	baseline,
}: {
	record: HistoryRecord;
	baseline?: Record<string, unknown>;
}) {
	const fields = snapshotFields(record);
	const flat = flattenObjectPropertyEntries(fields);
	const changes = baseline ? compareSnapshots(baseline, fields) : [];
	return (
		<>
			<dl className={styles.fields}>
				{flat.entries.map((entry) => {
					const path = toObjectDataJsonPointer(entry.segments);
					const change = changes.find(
						(item) => item.path === path || path.startsWith(`${item.path}/`),
					);
					return (
						<div
							key={entry.id}
							className={styles.field}
							data-kind={change?.kind}
						>
							<dt>
								<code>{entry.label}</code>
							</dt>
							<dd>
								{entry.value}
								{change ? (
									<span
										className={`status-pill ${styles.changeBadge}`}
										data-kind={change.kind}
									>
										{change.kind}
									</span>
								) : null}
							</dd>
						</div>
					);
				})}
				{changes
					.filter((change) => change.kind === "removed")
					.map((change) => (
						<div className={styles.field} key={change.path} data-kind="removed">
							<dt>
								<code>{change.path}</code>
							</dt>
							<dd>
								<span className="status-pill">removed</span>
								<span className="muted">Not present in this snapshot</span>
							</dd>
						</div>
					))}
			</dl>
			{flat.truncated ? (
				<p className="muted">
					Field preview is limited. The JSON view contains the full snapshot.
				</p>
			) : null}
			<details className={styles.json}>
				<summary>Snapshot JSON</summary>
				<JsonViewer value={fields} defaultTab="json" />
			</details>
		</>
	);
}

export function ResourceHistoryBrowser({
	scope,
	isAdmin = false,
}: {
	scope: HistoryScope;
	isAdmin?: boolean;
}) {
	const search = useSearchParams();
	const pathname = usePathname();
	const at = search.get("at") ?? "";
	const versionId = Number(search.get("version"));
	const comparisonMode = ["live", "pinned"].includes(
		search.get("compare") ?? "",
	)
		? (search.get("compare") ?? "previous")
		: "previous";
	const pinAt = search.get("pinAt") ?? "";
	const pinId = Number(search.get("pin"));
	const [expanded, setExpanded] = useState(false);
	const [onlyChanges, setOnlyChanges] = useState(true);
	const [jumpOpen, setJumpOpen] = useState(false);
	const [jumpValue, setJumpValue] = useState("");
	const [jumpError, setJumpError] = useState("");
	const [restoring, setRestoring] = useState<HistoryRecord | null>(null);
	const [success, setSuccess] = useState("");
	const [capturedLive, setCapturedLive] = useState<LiveHistoryResource | null>(
		null,
	);
	const history = useInfiniteQuery({
		queryKey: ["history-browser", scope],
		initialPageParam: "",
		queryFn: ({ pageParam }) =>
			fetchResourceHistoryPage(scope, {
				cursor: pageParam || undefined,
				limit: 25,
				sort: "-history_id",
				include_total: false,
			}),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
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
	const selectedLoaded = at
		? records.find(
				(record) =>
					record.history_id === versionId &&
					(record.valid_from === at || versionContains(record, at)),
			)
		: records[0];
	const validAt = !at || historyInstant(at) !== null;
	const asOf = useQuery({
		queryKey: ["history-as-of", scope, at],
		queryFn: async () => {
			const record = await fetchResourceHistoryAsOf(scope, at);
			if (!versionContains(record, at))
				throw new Error(
					"No active snapshot is available at this time. The resource may have been deleted or the historical interval may be unavailable.",
				);
			return record;
		},
		enabled: Boolean(at) && validAt && !selectedLoaded,
		retry: false,
	});
	const versionMismatch = Boolean(
		at &&
			search.has("version") &&
			asOf.data &&
			asOf.data.history_id !== versionId &&
			!selectedLoaded,
	);
	const selected =
		selectedLoaded ??
		(at && validAt && !versionMismatch ? asOf.data : undefined);
	const selectedIndex = records.findIndex(
		(record) => record.history_id === selected?.history_id,
	);
	const previous = selectedIndex >= 0 ? records[selectedIndex + 1] : undefined;
	const pinnedLoaded = records.find(
		(record) => record.history_id === pinId && record.valid_from === pinAt,
	);
	const pinned = useQuery({
		queryKey: ["history-as-of", scope, pinAt],
		queryFn: () => fetchResourceHistoryAsOf(scope, pinAt),
		enabled:
			comparisonMode === "pinned" &&
			Boolean(pinAt) &&
			historyInstant(pinAt) !== null &&
			!pinnedLoaded,
		retry: false,
	});
	const pinnedRecord =
		pinnedLoaded ??
		(pinned.data?.history_id === pinId ? pinned.data : undefined);
	const live = useQuery({
		queryKey: ["history-live", scope],
		queryFn: () => fetchHistoryLiveResource(scope),
		enabled: comparisonMode === "live",
		refetchInterval: 30_000,
		retry: false,
	});
	useEffect(() => {
		if (live.data && !capturedLive) setCapturedLive(live.data);
	}, [live.data, capturedLive]);
	const updateUrl = useCallback(
		(values: Record<string, string | null>, replace = false) => {
			const params = new URLSearchParams(window.location.search);
			for (const [key, value] of Object.entries(values)) {
				if (value === null) params.delete(key);
				else params.set(key, value);
			}
			window.history[replace ? "replaceState" : "pushState"](
				null,
				"",
				`${pathname}?${params}`,
			);
		},
		[pathname],
	);
	const selectVersion = useCallback(
		(record: HistoryRecord) => {
			updateUrl({ at: record.valid_from, version: String(record.history_id) });
		},
		[updateUrl],
	);
	useEffect(() => {
		if (!at && records[0])
			updateUrl(
				{ at: records[0].valid_from, version: String(records[0].history_id) },
				true,
			);
	}, [at, records, updateUrl]);
	const baselineRecord = comparisonMode === "pinned" ? pinnedRecord : previous;
	const baseline =
		comparisonMode === "live"
			? capturedLive?.fields
			: baselineRecord && !isDeletedVersion(baselineRecord)
				? snapshotFields(baselineRecord)
				: undefined;
	const baselineLabel =
		comparisonMode === "live"
			? `Live · revision ${capturedLive?.revision ?? "unavailable"}`
			: baselineRecord
				? `${comparisonMode === "pinned" ? "Pinned" : "Previous visible"} · ${historyTime(baselineRecord.valid_from)} UTC · #${baselineRecord.history_id}`
				: "Baseline unavailable";
	const liveChanged = Boolean(
		capturedLive &&
			live.data &&
			(capturedLive.revision !== live.data.revision ||
				capturedLive.etag !== live.data.etag ||
				compareSnapshots(capturedLive.fields, live.data.fields).length),
	);
	const deleted = selected ? isDeletedVersion(selected) : false;
	const taskId = selected ? getProvenanceTaskId(selected) : null;
	const compareControls = (
		<>
			<label className={styles.comparisonBaseline}>
				<span>Compare with</span>
				<select
					value={comparisonMode}
					onChange={(event) => updateUrl({ compare: event.target.value })}
				>
					<option value="previous">Previous visible</option>
					<option value="live">Live</option>
					<option value="pinned" disabled={!pinAt}>
						Pinned version
					</option>
				</select>
			</label>
			{selected && !deleted ? (
				<button
					type="button"
					className={`icon-button ${styles.pin}`}
					aria-label="Pin as baseline"
					title="Pin selected version as baseline"
					aria-pressed={
						pinId === selected.history_id && pinAt === selected.valid_from
					}
					onClick={() =>
						updateUrl({
							pin: String(selected.history_id),
							pinAt: selected.valid_from,
							compare: "pinned",
						})
					}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2zm-6 2H7.83L9 12.83V4h6v8.83L16.17 14z"
							fill="currentColor"
						/>
					</svg>
				</button>
			) : null}
			<button
				type="button"
				className="secondary"
				aria-expanded={expanded}
				onClick={() => setExpanded((value) => !value)}
			>
				{expanded ? "Close comparison" : "Compare snapshots"}
			</button>
			{expanded ? (
				<label className={styles.choice}>
					<input
						type="checkbox"
						checked={onlyChanges}
						onChange={(event) => setOnlyChanges(event.target.checked)}
					/>
					Only changes
				</label>
			) : null}
		</>
	);
	return (
		<section
			className={`stack ${styles.browser}`}
			aria-label={`${scope.type === "object" ? "Object" : "Class definition"} history`}
		>
			<header className={`panel-header ${styles.heading}`}>
				<div>
					<h1 className={styles.historyTitle}>
						{selected?.name ??
							`${scope.type === "object" ? `Object #${scope.objectId}` : `Class #${scope.classId}`}`}
						{selected ? (
							<small className={styles.versionRange}>
								[ {deleted ? "Deletion marker · " : null}
								<time dateTime={selected.valid_from}>
									{historyTime(selected.valid_from)} UTC
								</time>
								{!deleted ? (
									<>
										{" → "}
										{selected.valid_to ? (
											<>
												<time dateTime={selected.valid_to}>
													{historyTime(selected.valid_to)} UTC
												</time>{" "}
												(exclusive)
											</>
										) : (
											"no known end"
										)}
									</>
								) : null}{" "}
								]
							</small>
						) : null}
					</h1>
				</div>
				<div className="action-row">
					<Link className="link-chip" href={resourceHref(scope)}>
						Back to live
					</Link>
					<Link
						className="link-chip"
						href={`${resourceHref(scope)}#resource-activity`}
					>
						Audit trail
					</Link>
				</div>
			</header>
			<fieldset
				className={styles.toolbar}
				aria-label="History comparison and navigation"
			>
				{selected && !deleted ? compareControls : null}
				<button
					type="button"
					className={styles.jump}
					onClick={() => setJumpOpen(true)}
				>
					Jump to date
				</button>
			</fieldset>
			{success ? (
				<p role="status" className="success-banner">
					{success}
				</p>
			) : null}
			{history.isLoading || (at && !selectedLoaded && asOf.isFetching) ? (
				<p role="status">Loading historical snapshots…</p>
			) : null}
			{history.isError ? (
				<p role="alert" className="error-banner">
					Could not load the history list: {history.error.message}
				</p>
			) : null}
			{!validAt ? (
				<p role="alert" className="error-banner">
					The selected timestamp is invalid. Use Jump to date to choose another
					instant.
				</p>
			) : null}
			{at && !selectedLoaded && asOf.isError ? (
				<p role="alert" className="error-banner">
					Snapshot unavailable at {at}. {asOf.error.message} Dates before known
					history, deletion, retention, or permission limits may make snapshots
					unavailable.
				</p>
			) : null}
			{versionMismatch ? (
				<p role="alert" className="error-banner">
					The requested version does not match the snapshot at this time. Choose
					another visible entry.
				</p>
			) : null}
			{!history.isLoading &&
			!history.isError &&
			!records.length &&
			!selected ? (
				<p className="empty-state">No history is visible for this resource.</p>
			) : null}
			{selected ? (
				<>
					<HistoryStackNavigation
						records={records}
						selected={selected}
						onSelect={selectVersion}
						loadOlder={
							history.hasNextPage
								? () => {
										void history.fetchNextPage();
									}
								: undefined
						}
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
										Stored version #{selected.history_id} · {selected.op}
									</p>
								</div>
								{scope.type === "object" && "data" in selected && !deleted ? (
									<button
										type="button"
										className={styles.restore}
										onClick={() => {
											updateUrl({ compare: "live" });
											setRestoring(selected);
										}}
									>
										Restore to live…
									</button>
								) : null}
							</header>
							{!deleted ? (
								<>
									<p className={styles.baseline}>{baselineLabel}</p>
									{comparisonMode === "live" && live.isError ? (
										<p className="error-banner" role="alert">
											Live comparison is unavailable. {live.error.message}
										</p>
									) : null}
									{comparisonMode === "live" &&
									live.isFetching &&
									!capturedLive ? (
										<p role="status">Loading live baseline…</p>
									) : null}
									{liveChanged && comparisonMode === "live" ? (
										<div className={styles.refreshNotice} role="status">
											Live has changed. This comparison still uses revision{" "}
											{capturedLive?.revision}.{" "}
											<button
												type="button"
												className="secondary"
												onClick={() => live.data && setCapturedLive(live.data)}
											>
												Refresh comparison
											</button>
										</div>
									) : null}
									{!baseline && comparisonMode === "previous" ? (
										<p className="muted">
											{history.hasNextPage || selectedIndex < 0
												? "Load older history to find the previous visible version."
												: "No earlier visible version is available."}
										</p>
									) : null}
									{!baseline && comparisonMode === "pinned" ? (
										<p className="muted">
											{pinned.isFetching
												? "Loading pinned baseline…"
												: "The pinned version is unavailable or inaccessible. Pin another visible snapshot."}
										</p>
									) : null}
									{expanded && baseline ? (
										<HistoryComparison
											before={baseline}
											after={snapshotFields(selected)}
											baselineLabel={baselineLabel}
											selectedLabel={`Selected · ${historyTime(selected.valid_from)} UTC · #${selected.history_id}`}
											onlyChanges={onlyChanges}
										/>
									) : (
										<SnapshotPresentation
											record={selected}
											baseline={baseline}
										/>
									)}
								</>
							) : (
								<p>
									This marker records the deletion. Choose an earlier visible
									snapshot to inspect the resource before deletion.
								</p>
							)}
						</article>
					</HistoryStackNavigation>
					<p className={styles.note}>
						Only authorized snapshots are shown; history may be incomplete.{" "}
						{scope.type === "class"
							? "Class definition history does not include the historical object population. Class restoration is not yet available."
							: "Historical class definitions, relationships, and computed values are unavailable here."}{" "}
						Collection and class IDs come from the snapshot; current labels are
						not substituted.
					</p>
					<details className={styles.provenance}>
						<summary>Version details and provenance</summary>
						<dl className="event-detail-grid">
							<div>
								<dt>Actor</dt>
								<dd>{selected.actor_username ?? formatEventActor(selected)}</dd>
							</div>
							<div>
								<dt>Initiator</dt>
								<dd>{formatEventInitiator(selected)}</dd>
							</div>
							<div>
								<dt>Task</dt>
								<dd>
									{taskId ? (
										<Link href={`/tasks/${taskId}`}>#{taskId}</Link>
									) : (
										"Not recorded"
									)}
								</dd>
							</div>
							<div>
								<dt>Valid from (exact)</dt>
								<dd>{selected.valid_from}</dd>
							</div>
							<div>
								<dt>Valid until (exclusive)</dt>
								<dd>{selected.valid_to ?? "No known end"}</dd>
							</div>
						</dl>
					</details>
				</>
			) : records.length ? (
				<button
					type="button"
					className="secondary"
					onClick={() => selectVersion(records[0])}
				>
					Show latest visible entry
				</button>
			) : null}
			<CreateModal
				open={jumpOpen}
				title="Jump to date"
				onClose={() => setJumpOpen(false)}
			>
				<form
					className="stack"
					onSubmit={(event) => {
						event.preventDefault();
						const value = `${jumpValue.length === 16 ? `${jumpValue}:00` : jumpValue}Z`;
						if (historyInstant(value) === null) {
							setJumpError("Choose a valid date and time.");
							return;
						}
						updateUrl({ at: value, version: null });
						setJumpOpen(false);
						setJumpError("");
					}}
				>
					<label>
						<span>Date and time (UTC)</span>
						<input
							type="datetime-local"
							step="0.001"
							required
							value={jumpValue}
							onChange={(event) => setJumpValue(event.target.value)}
						/>
					</label>
					{jumpError ? <p role="alert">{jumpError}</p> : null}
					<button type="submit">View at time</button>
				</form>
			</CreateModal>
			{restoring && "data" in restoring && scope.type === "object" ? (
				<ObjectHistoryRestore
					key={restoring.history_id}
					scope={scope}
					source={restoring}
					isAdmin={isAdmin}
					onClose={() => setRestoring(null)}
					onRestored={() => {
						setRestoring(null);
						setSuccess(
							"Historical values restored as a new audited update. You are still viewing the source snapshot.",
						);
					}}
				/>
			) : null}
		</section>
	);
}
