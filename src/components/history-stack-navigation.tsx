"use client";

import { useEffect, useRef } from "react";
import type { HistoryRecord } from "@/lib/api/events";
import {
	compareSnapshots,
	isDeletedVersion,
	snapshotFields,
} from "@/lib/resource-history";
import styles from "@/components/resource-history.module.css";

export function historyTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: new Intl.DateTimeFormat(undefined, {
				dateStyle: "medium",
				timeStyle: "medium",
				timeZone: "UTC",
			}).format(date);
}

function summary(record: HistoryRecord, earlier?: HistoryRecord): string {
	if (isDeletedVersion(record)) return "Deleted";
	if (!earlier || isDeletedVersion(earlier)) return record.op;
	const changes = compareSnapshots(
		snapshotFields(earlier),
		snapshotFields(record),
	);
	return changes.length
		? `${changes.length} ${changes.length === 1 ? "change" : "changes"} · ${changes
				.slice(0, 2)
				.map((change) => change.path)
				.join(", ")}`
		: "No stored field changes";
}

const TIMELINE_STEP = 80;

export function HistoryStackNavigation({
	records,
	selected,
	onSelect,
	loadOlder,
	loadingOlder,
	children,
}: {
	records: HistoryRecord[];
	selected: HistoryRecord;
	onSelect: (record: HistoryRecord) => void;
	loadOlder?: () => void;
	loadingOlder: boolean;
	children: React.ReactNode;
}) {
	const timelineRef = useRef<HTMLDivElement>(null);
	const timelineHeight = useRef(0);
	const scrollFrame = useRef<number | null>(null);
	const scrollSelection = useRef<number | null>(null);
	const requestedPage = useRef<number | null>(null);
	const index = records.findIndex(
		(record) => record.history_id === selected.history_id,
	);
	// Keep the surrounding fan light even when many history pages are loaded.
	const surrounding =
		index < 0
			? []
			: records
					.slice(Math.max(0, index - 10), Math.max(0, index) + 21)
					.filter((record) => record.history_id !== selected.history_id)
					.sort(
						(a, b) =>
							Math.abs(records.indexOf(a) - index) -
							Math.abs(records.indexOf(b) - index),
					)
					.slice(0, 20);

	useEffect(() => {
		if (index < 0 || !timelineRef.current) return;
		const viewport = timelineRef.current;
		timelineHeight.current = viewport.clientHeight;
		const observer = new ResizeObserver(() => {
			if (viewport.clientHeight === timelineHeight.current) return;
			timelineHeight.current = viewport.clientHeight;
			if (scrollFrame.current !== null) {
				cancelAnimationFrame(scrollFrame.current);
				scrollFrame.current = null;
			}
			scrollSelection.current = null;
			viewport.scrollTop = index * TIMELINE_STEP;
		});
		observer.observe(viewport);
		if (scrollSelection.current === selected.history_id) {
			scrollSelection.current = null;
		} else {
			viewport.scrollTop = index * TIMELINE_STEP;
		}
		return () => observer.disconnect();
	}, [index, selected.history_id]);
	useEffect(
		() => () => {
			if (scrollFrame.current !== null)
				cancelAnimationFrame(scrollFrame.current);
		},
		[],
	);

	function choose(record: HistoryRecord, focus = false) {
		scrollSelection.current = null;
		if (record.history_id !== selected.history_id) onSelect(record);
		if (focus)
			timelineRef.current
				?.querySelector<HTMLButtonElement>(
					`[data-version="${record.history_id}"]`,
				)
				?.focus({ preventScroll: true });
	}
	function followScroll() {
		if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
		scrollFrame.current = requestAnimationFrame(() => {
			scrollFrame.current = null;
			const viewport = timelineRef.current;
			if (!viewport) return;
			// Resizing changes the centering padding; it is not timeline travel.
			if (index >= 0 && viewport.clientHeight !== timelineHeight.current) {
				viewport.scrollTop = index * TIMELINE_STEP;
				return;
			}
			const top = viewport.scrollTop;
			const position = Math.max(
				0,
				Math.min(records.length - 1, Math.round(top / TIMELINE_STEP)),
			);
			const record = records[position];
			if (record && record.history_id !== selected.history_id) {
				scrollSelection.current = record.history_id;
				onSelect(record);
			}
			if (
				top > 0 &&
				position >= records.length - 3 &&
				loadOlder &&
				!loadingOlder &&
				requestedPage.current !== records.length
			) {
				requestedPage.current = records.length;
				loadOlder();
			}
		});
	}
	function renderFan(direction: "newer" | "older") {
		const newer = direction === "newer";
		const versions = surrounding.filter((record) =>
			newer ? records.indexOf(record) < index : records.indexOf(record) > index,
		);
		const count = index < 0 ? null : newer ? index : records.length - index - 1;
		return (
			<div
				className={styles.fanSide}
				data-direction={direction}
				role="img"
				aria-label={`${newer ? "Newer" : "Older"} snapshot fan, ${count ?? "unknown"} ${direction} versions loaded`}
			>
				<div className={styles.fanCards} aria-hidden="true">
					{versions.map((record, layer) => (
						<div
							key={record.history_id}
							className={styles.fanCard}
							data-nearest={layer === 0}
							style={
								{
									"--depth": layer,
									"--title-step": Math.min(layer, 3),
									"--tail-step": Math.max(0, layer - 3),
									zIndex: 20 - layer,
								} as React.CSSProperties
							}
						>
							{layer < 4 ? (
								<>
									<span>
										<time dateTime={record.valid_from}>
											{historyTime(record.valid_from)} UTC
										</time>{" "}
										· #{record.history_id}
									</span>
									{layer === 0 ? (
										<span className={styles.fanSummary}>
											{summary(record, records[records.indexOf(record) + 1])}
										</span>
									) : null}
								</>
							) : null}
						</div>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className={styles.historyExplorer}>
			<nav
				className={styles.timeline}
				aria-label="History timeline"
				onKeyDown={(event) => {
					if (
						event.altKey ||
						event.ctrlKey ||
						event.metaKey ||
						!(event.target instanceof HTMLElement) ||
						!event.target.closest("[data-version]")
					)
						return;
					const position =
						event.key === "ArrowUp"
							? index - 1
							: event.key === "ArrowDown"
								? index + 1
								: event.key === "Home"
									? 0
									: event.key === "End"
										? records.length - 1
										: null;
					if (position === null) return;
					event.preventDefault();
					const destination = records[position];
					if (destination) choose(destination, true);
				}}
			>
				<div className={styles.timelineHeading}>
					<strong>Timeline</strong>
					{index >= 0 ? (
						<span
							title="Loaded versions newer than the selected snapshot"
						>
							{index} newer
						</span>
					) : null}
				</div>
				<div className={styles.timelineWindow}>
					<div className={styles.timelineCursor} aria-hidden="true" />
					<div
						className={styles.timelineViewport}
						ref={timelineRef}
						onScroll={followScroll}
						onScrollEnd={(event) => {
							// CSS snapping also fires on resize, so center only after scrolling.
							const viewport = event.currentTarget;
							viewport.scrollTop =
								Math.round(viewport.scrollTop / TIMELINE_STEP) * TIMELINE_STEP;
						}}
					>
						<ol className={styles.timelineEntries}>
							{records.map((record) => (
								<li key={record.history_id}>
									<button
										type="button"
										className={styles.timelineEntry}
										data-version={record.history_id}
										aria-label={`View version #${record.history_id} · ${historyTime(record.valid_from)} UTC`}
										aria-current={
											record.history_id === selected.history_id
												? "step"
												: undefined
										}
										tabIndex={
											record.history_id === selected.history_id ||
											(index < 0 && record === records[0])
												? 0
												: -1
										}
										onClick={() => choose(record)}
									>
										<span className={styles.timelineDot} aria-hidden="true" />
										<time dateTime={record.valid_from}>
											{new Intl.DateTimeFormat(undefined, {
												month: "short",
												day: "numeric",
												timeZone: "UTC",
											}).format(new Date(record.valid_from))}
											<span className={styles.timelineYear}>
												, {new Date(record.valid_from).getUTCFullYear()}
											</span>
										</time>
										<small>
											{new Intl.DateTimeFormat(undefined, {
												hour: "2-digit",
												minute: "2-digit",
												hourCycle: "h23",
												timeZone: "UTC",
											}).format(new Date(record.valid_from))}{" "}
											· #{record.history_id}
										</small>
									</button>
								</li>
							))}
						</ol>
					</div>
				</div>
				<div className={styles.timelineFooter}>
					{index >= 0 ? (
						<span
							title="Loaded versions older than the selected snapshot"
						>
							{records.length - index - 1} older
						</span>
					) : null}
					<p>
						Scroll to travel · UTC
						<span className={styles.timelineYear}> · ↑ ↓ keys</span>
					</p>
					{loadingOlder ? (
						<p role="status">Loading history…</p>
					) : loadOlder ? (
						<button type="button" className="ghost" onClick={loadOlder}>
							Load more history
						</button>
					) : (
						<small>End of visible history</small>
					)}
					{index < 0 ? (
						<p>This snapshot is outside the loaded timeline.</p>
					) : null}
				</div>
			</nav>
			<div className={styles.fanStage}>
				{renderFan("newer")}
				<section
					className={styles.selectedSnapshot}
					aria-label="Selected snapshot"
					key={selected.history_id}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable snapshot needs keyboard access.
					tabIndex={0}
				>
					{children}
				</section>
				{renderFan("older")}
				<p className={styles.fanCaption}>
					Scroll the timeline to travel · Scroll the snapshot to read
					<br />
					Change order · time gaps compressed
				</p>
			</div>
		</div>
	);
}
