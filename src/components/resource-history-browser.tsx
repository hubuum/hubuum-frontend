"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { ClassHistoryRestore } from "@/components/class-history-restore";
import { HistoricalResourceContext } from "@/components/historical-resource-context";
import { HistoryComparison } from "@/components/history-comparison";
import { HistoryContext } from "@/components/history-context";
import { HistoryNameBrowser } from "@/components/history-name-browser";
import { SnapshotPresentation } from "@/components/history-snapshot-presentation";
import {
	HistoryStackNavigation,
	historyTime,
} from "@/components/history-stack-navigation";
import { ObjectHistoryRestore } from "@/components/object-history-restore";
import styles from "@/components/resource-history.module.css";
import type { HistoryRecord } from "@/lib/api/events";
import type { HistoryResponseHistoryMarker } from "@/lib/api/generated/models";
import { fetchHistoryEntry } from "@/lib/api/history-navigation";
import {
	fetchHistoryLiveResource,
	type LiveHistoryResource,
} from "@/lib/api/resource-history";
import {
	formatEventActor,
	formatEventInitiator,
	getProvenanceTaskId,
} from "@/lib/event-provenance";
import {
	compareSnapshots,
	type HistoryScope,
	historyInstant,
	isDeletedVersion,
	resourceHref,
	snapshotFields,
	versionContains,
} from "@/lib/resource-history";
import { historyVersionId } from "@/lib/history-timeline";
import { useHistoryTimeline } from "@/lib/use-history-timeline";
import { useHistorySelection } from "@/lib/use-history-selection";

export function ResourceHistoryBrowser({ scope }: { scope: HistoryScope }) {
	const search = useSearchParams();
	const { preview, updateUrl, selectVersion } =
		useHistorySelection<HistoryResponseHistoryMarker>();
	const at = search.get("at") ?? "";
	const versionId = historyVersionId(search.get("version"));
	const comparisonMode = ["live", "pinned"].includes(
		search.get("compare") ?? "",
	)
		? (search.get("compare") ?? "previous")
		: "previous";
	const pinAt = search.get("pinAt") ?? "";
	const pinId = historyVersionId(search.get("pin"));
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
	const validAt = !at || historyInstant(at) !== null;
	const validVersion = !search.has("version") || versionId !== undefined;
	const timeline = useHistoryTimeline(
		scope,
		versionId,
		at,
		validAt && validVersion,
		preview,
	);
	const { records, selected, snapshot, older: history, newer } = timeline;
	const selectedIndex = records.findIndex(
		(record) => record.history_id === selected?.history_id,
	);
	const previous = selectedIndex >= 0 ? records[selectedIndex + 1] : undefined;
	const baselineId =
		comparisonMode === "pinned"
			? pinId
			: comparisonMode === "previous"
				? previous?.history_id
				: undefined;
	const pinned = useQuery({
		queryKey: ["history-browser", scope, "entry", baselineId],
		queryFn: ({ signal }) =>
			fetchHistoryEntry(scope, baselineId as number, signal),
		enabled:
			baselineId !== undefined &&
			snapshot !== undefined &&
			!isDeletedVersion(snapshot),
		retry: false,
	});
	const baselineRecord =
		!pinned.isError &&
		pinned.data &&
		(comparisonMode !== "pinned" ||
			!pinAt ||
			pinned.data.valid_from === pinAt ||
			versionContains(pinned.data, pinAt))
			? pinned.data
			: undefined;
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
	useEffect(() => {
		if (!at && versionId === undefined && validVersion && records[0])
			updateUrl(
				{ at: records[0].valid_from, version: String(records[0].history_id) },
				true,
			);
	}, [at, versionId, validVersion, records, updateUrl]);
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
			<HistoryNameBrowser
				key={`${search.get("historyMatch")}:${search.get("historyName")}`}
				scope={scope}
				name={selected?.name}
			/>
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
			{timeline.loading && !selected ? (
				<p role="status">Loading historical snapshots…</p>
			) : null}
			{history.isError || newer.isError ? (
				<p role="alert" className="error-banner">
					Could not load the history list:{" "}
					{history.error?.message ?? newer.error?.message}
					<button
						type="button"
						onClick={() => {
							if (history.isError) void history.refetch();
							if (newer.isError) void newer.refetch();
						}}
					>
						Retry timeline
					</button>
				</p>
			) : null}
			{!validAt || !validVersion ? (
				<p role="alert" className="error-banner">
					The selected timestamp or version is invalid. Use Jump to date to
					choose another instant.
				</p>
			) : null}
			{timeline.error ? (
				<p role="alert" className="error-banner">
					Snapshot unavailable at {at}. {timeline.error.message} Dates before
					known history, deletion, retention, or permission limits may make
					snapshots unavailable.
				</p>
			) : null}
			{timeline.mismatch ? (
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
						loadNewer={
							newer.hasNextPage
								? () => {
										void newer.fetchNextPage();
									}
								: undefined
						}
						loadingNewer={newer.isFetchingNextPage}
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
										{scope.type} #{selected.id}
									</p>
								</div>
								{!deleted && snapshot ? (
									<button
										type="button"
										className={styles.restore}
										onClick={() => {
											updateUrl({ compare: "live" });
											setRestoring(snapshot);
										}}
									>
										Restore to live…
									</button>
								) : null}
							</header>
							{!snapshot ? (
								<p role="status">
									{timeline.error
										? "Snapshot unavailable."
										: "Loading snapshot…"}{" "}
									{timeline.error ? (
										<button type="button" onClick={timeline.retrySnapshot}>
											Retry snapshot
										</button>
									) : null}
								</p>
							) : !deleted ? (
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
									{comparisonMode !== "live" && pinned.isError ? (
										<p role="alert">
											Comparison snapshot unavailable. {pinned.error.message}{" "}
											<button
												type="button"
												onClick={() => void pinned.refetch()}
											>
												Retry comparison
											</button>
										</p>
									) : null}
									{!baseline &&
									pinned.isFetching &&
									comparisonMode === "previous" ? (
										<p role="status">Loading previous baseline…</p>
									) : null}
									{!baseline &&
									!pinned.isFetching &&
									!pinned.isError &&
									comparisonMode === "previous" ? (
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
											after={snapshotFields(snapshot)}
											baselineLabel={baselineLabel}
											selectedLabel={`Selected · ${historyTime(selected.valid_from)} UTC · #${selected.history_id}`}
											onlyChanges={onlyChanges}
										/>
									) : (
										<SnapshotPresentation
											record={snapshot}
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
							? "Class restoration supports names, descriptions, and collection assignments; it does not restore the historical object population."
							: "Open the historical context panels to inspect relationships and recomputed values at this time."}{" "}
						Collection and class IDs come from the snapshot; current labels are
						not substituted.
					</p>
					{!deleted && "collection_id" in selected ? (
						<>
							<HistoryContext
								record={selected}
								at={preview ? selected.valid_from : at || selected.valid_from}
							/>
							<HistoricalResourceContext
								scope={scope}
								record={selected}
								at={preview ? selected.valid_from : at || selected.valid_from}
							/>
						</>
					) : null}
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
					Show newest loaded entry
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
					onClose={() => setRestoring(null)}
					onRestored={() => {
						setRestoring(null);
						setSuccess(
							"Historical values restored as a new audited update. You are still viewing the source snapshot.",
						);
					}}
				/>
			) : null}
			{restoring && "validate_schema" in restoring && scope.type === "class" ? (
				<ClassHistoryRestore
					key={restoring.history_id}
					scope={scope}
					source={restoring}
					onClose={() => setRestoring(null)}
					onRestored={() => {
						setRestoring(null);
						setSuccess(
							"Historical class fields restored as a new audited update. You are still viewing the source snapshot.",
						);
					}}
				/>
			) : null}
		</section>
	);
}
