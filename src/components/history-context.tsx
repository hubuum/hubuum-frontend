"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
import styles from "@/components/resource-history.module.css";
import type { HistoryRecord } from "@/lib/api/events";
import { fetchHistoricalContext } from "@/lib/api/resource-history";

export function HistoryContext({
	record,
	at,
}: {
	record: Extract<HistoryRecord, { collection_id: number }>;
	at: string;
}) {
	const [open, setOpen] = useState(false);
	const classId = "hubuum_class_id" in record ? record.hubuum_class_id : null;
	const historicalClass = useQuery({
		queryKey: ["history-context", "class", classId, at],
		queryFn: () => {
			if (classId === null) throw new Error("No historical class selected.");
			return fetchHistoricalContext({ type: "class", classId }, at);
		},
		enabled: open && classId !== null,
		retry: false,
	});
	const historicalCollection = useQuery({
		queryKey: ["history-context", "collection", record.collection_id, at],
		queryFn: () =>
			fetchHistoricalContext(
				{ type: "collection", collectionId: record.collection_id },
				at,
			),
		enabled: open,
		retry: false,
	});
	const classSnapshot =
		!historicalClass.isError &&
		historicalClass.data &&
		"validate_schema" in historicalClass.data
			? historicalClass.data
			: null;
	const collectionSnapshot = historicalCollection.isError
		? null
		: historicalCollection.data;

	return (
		<details
			className={styles.provenance}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary>Historical class and collection context</summary>
			<section className="stack" aria-label="Historical context">
				<p>
					Context at <time dateTime={at}>{at}</time>. Unavailable history is
					never replaced with current values.
				</p>
				<dl className="event-detail-grid">
					<div>
						<dt>Collection at this time</dt>
						<dd>
							{collectionSnapshot?.name ??
								(historicalCollection.isPending
									? "Loading historical collection…"
									: "Historical collection unavailable")}{" "}
							(#{record.collection_id})
						</dd>
					</div>
					{classId !== null ? (
						<div>
							<dt>Class at this time</dt>
							<dd>
								{classSnapshot?.name ??
									(historicalClass.isPending
										? "Loading historical class…"
										: "Historical class unavailable")}{" "}
								(#{classId})
							</dd>
						</div>
					) : null}
					{classSnapshot ? (
						<div>
							<dt>Schema validation at this time</dt>
							<dd>{classSnapshot.validate_schema ? "Enabled" : "Disabled"}</dd>
						</div>
					) : null}
				</dl>
				{classSnapshot ? (
					<details>
						<summary>Class schema at this time</summary>
						{Object.hasOwn(classSnapshot, "json_schema") ? (
							<JsonViewer value={classSnapshot.json_schema} defaultTab="json" />
						) : (
							<p>Schema unavailable in this historical snapshot.</p>
						)}
					</details>
				) : null}
			</section>
		</details>
	);
}
