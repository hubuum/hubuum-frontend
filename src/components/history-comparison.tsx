"use client";

import { compareSnapshots } from "@/lib/resource-history";
import { flattenObjectPropertyEntries } from "@/lib/object-property-entries";
import { toObjectDataJsonPointer } from "@/lib/api/object-data-patch";
import styles from "@/components/resource-history.module.css";

export function HistoryValue({
	value,
	missing = false,
}: {
	value: unknown;
	missing?: boolean;
}) {
	return missing ? (
		<span className="muted">Not present</span>
	) : (
		<pre className={styles.value}>{JSON.stringify(value, null, 2)}</pre>
	);
}

export function HistoryComparison({
	before,
	after,
	baselineLabel,
	selectedLabel,
	onlyChanges,
}: {
	before: unknown;
	after: unknown;
	baselineLabel: string;
	selectedLabel: string;
	onlyChanges: boolean;
}) {
	const changes = compareSnapshots(before, after);
	const unchanged = onlyChanges
		? []
		: flattenObjectPropertyEntries(after).entries.filter((entry) => {
				const path = toObjectDataJsonPointer(entry.segments);
				return !changes.some(
					(change) =>
						path === change.path ||
						path.startsWith(`${change.path}/`) ||
						change.path.startsWith(`${path}/`),
				);
			});
	return (
		<section className={styles.comparison} aria-label="Snapshot comparison">
			<div className={styles.comparisonHeading}>
				<strong>{baselineLabel}</strong>
				<strong>{selectedLabel}</strong>
			</div>
			{changes.map((change) => (
				<div className={styles.comparisonRow} key={change.path}>
					<div className={styles.changePath}>
						<code>{change.path || "Entire document"}</code>
						<span
							className={`status-pill ${styles.changeBadge}`}
							data-kind={change.kind}
						>
							{change.kind}
						</span>
					</div>
					<div className={styles.comparisonValues}>
						<HistoryValue
							value={change.before}
							missing={change.kind === "added"}
						/>
						<HistoryValue
							value={change.after}
							missing={change.kind === "removed"}
						/>
					</div>
				</div>
			))}
			{unchanged.map((entry) => (
				<div className={styles.comparisonRow} key={entry.id}>
					<div className={styles.changePath}>
						<code>{entry.label}</code>
						<span className="muted">Unchanged</span>
					</div>
					<div className={styles.comparisonValues}>
						<span>{entry.value}</span>
						<span>{entry.value}</span>
					</div>
				</div>
			))}
			{!changes.length && onlyChanges ? (
				<p className={styles.empty}>No differences from this baseline.</p>
			) : null}
			{!onlyChanges ? (
				<p className={styles.note}>
					Unchanged fields show the first 200 entries, up to 8 levels deep. Use
					the snapshot JSON for the complete document.
				</p>
			) : null}
		</section>
	);
}
