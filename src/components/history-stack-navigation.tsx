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
		? `${changes.length} changes · ${changes
				.slice(0, 2)
				.map((change) => change.path)
				.join(", ")}`
		: "No stored field changes";
}

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
	const navigatorRef = useRef<HTMLFieldSetElement>(null);
	const stackRef = useRef<HTMLDivElement>(null);
	const index = records.findIndex(
		(record) => record.history_id === selected.history_id,
	);
	const earlier = index >= 0 ? records[index + 1] : undefined;
	const later = index > 0 ? records[index - 1] : undefined;
	const behind =
		index >= 0 ? records.slice(index + 1, index + 3).reverse() : [];
	useEffect(() => {
		const navigator = navigatorRef.current;
		const stack = stackRef.current;
		if (!navigator || !stack) return;
		let accumulated = 0;
		let gestureStarted = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		function wheel(event: WheelEvent) {
			if (
				event.ctrlKey ||
				event.metaKey ||
				Math.abs(event.deltaX) > Math.abs(event.deltaY)
			)
				return;
			const target = event.deltaY > 0 ? earlier : later;
			if (!target) return;
			event.preventDefault();
			const delta =
				event.deltaY *
				(event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
			accumulated += delta;
			if (!timer) gestureStarted = performance.now();
			stack?.style.setProperty(
				"--history-glide",
				`${Math.max(-22, Math.min(22, accumulated / 7))}px`,
			);
			clearTimeout(timer);
			// Settle short gestures; keep moving during a continuous scroll.
			timer = setTimeout(
				() => {
					stack?.style.removeProperty("--history-glide");
					const destination = accumulated > 0 ? earlier : later;
					if (destination && Math.abs(accumulated) >= 36) onSelect(destination);
					accumulated = 0;
					timer = undefined;
				},
				Math.max(0, Math.min(150, 240 - (performance.now() - gestureStarted))),
			);
		}
		navigator.addEventListener("wheel", wheel, { passive: false });
		return () => {
			clearTimeout(timer);
			navigator.removeEventListener("wheel", wheel);
			stack.style.removeProperty("--history-glide");
		};
	}, [earlier, later, onSelect]);
	return (
		<div className={styles.stack} ref={stackRef}>
			<fieldset
				className={styles.navigator}
				ref={navigatorRef}
				tabIndex={-1}
				aria-label="Snapshot navigation: scroll here to glide through versions"
				onKeyDown={(event) => {
					if (
						event.target instanceof HTMLSelectElement ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey
					)
						return;
					const destination = ["ArrowLeft", "ArrowUp"].includes(event.key)
						? earlier
						: ["ArrowRight", "ArrowDown"].includes(event.key)
							? later
							: undefined;
					if (destination) {
						event.preventDefault();
						navigatorRef.current?.focus();
						onSelect(destination);
					}
				}}
			>
				<div className="action-row">
					<button
						type="button"
						className="secondary"
						disabled={!earlier}
						onClick={() => earlier && onSelect(earlier)}
						aria-keyshortcuts="ArrowLeft ArrowUp"
					>
						← Earlier
					</button>
					<button
						type="button"
						className="secondary"
						disabled={!later}
						onClick={() => later && onSelect(later)}
						aria-keyshortcuts="ArrowRight ArrowDown"
					>
						Later →
					</button>
					<label className={styles.versionSelect}>
						<span className="sr-only">Select a stored version</span>
						<select
							value={selected.history_id}
							onChange={(event) => {
								const record = records.find(
									(item) => item.history_id === Number(event.target.value),
								);
								if (record) onSelect(record);
							}}
						>
							{index < 0 ? (
								<option value={selected.history_id}>
									{historyTime(selected.valid_from)} · #{selected.history_id}
								</option>
							) : null}
							{records.map((record) => (
								<option key={record.history_id} value={record.history_id}>
									{historyTime(record.valid_from)} · #{record.history_id} ·{" "}
									{record.op}
								</option>
							))}
						</select>
					</label>
					{loadOlder ? (
						<button
							type="button"
							className="secondary"
							disabled={loadingOlder}
							onClick={loadOlder}
						>
							{loadingOlder ? "Loading older…" : "Load older"}
						</button>
					) : null}
				</div>
				<p className="muted">
					Scroll here to glide · change order, time gaps compressed
				</p>
			</fieldset>
			<div className={styles.layers}>
				{behind.map((record, layer) => (
					<button
						type="button"
						key={record.history_id}
						className={`${styles.layer} ${layer === 0 && behind.length > 1 ? styles.farLayer : styles.nearLayer}`}
						onClick={() => onSelect(record)}
					>
						<time dateTime={record.valid_from}>
							{historyTime(record.valid_from)} UTC
						</time>
						<span>{summary(record, records[records.indexOf(record) + 1])}</span>
					</button>
				))}
				{children}
			</div>
		</div>
	);
}
