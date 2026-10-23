import { JsonViewer } from "@/components/json-viewer";
import styles from "@/components/resource-history.module.css";
import type { HistoryRecord } from "@/lib/api/events";
import { toObjectDataJsonPointer } from "@/lib/api/object-data-patch";
import { flattenObjectPropertyEntries } from "@/lib/object-property-entries";
import { compareSnapshots, snapshotFields } from "@/lib/resource-history";

export function SnapshotPresentation({
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
