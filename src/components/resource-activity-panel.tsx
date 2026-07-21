"use client";

import { useQuery } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { EventDetailsModal } from "@/components/event-details-modal";
import { HistoryDetailsModal } from "@/components/history-details-modal";
import { JsonViewer } from "@/components/json-viewer";
import { TableExportMenu } from "@/components/table-export-menu";
import {
	fetchResourceEventsPage,
	fetchResourceHistoryAsOf,
	fetchResourceHistoryPage,
	type EventRecord,
	type HistoryRecord,
	type ResourceEventScope,
} from "@/lib/api/events";

type ResourceActivityPanelProps = {
	scope: ResourceEventScope;
	title: string;
};

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "n/a";
	}

	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

function formatActor(
	record: Pick<EventRecord, "actor_kind" | "actor_user_id">,
): string {
	if (record.actor_user_id == null) {
		return record.actor_kind;
	}

	return `${record.actor_kind} #${record.actor_user_id}`;
}

function formatHistoryActor(record: HistoryRecord): string {
	if (record.actor_username) {
		return record.actor_id == null
			? record.actor_username
			: `${record.actor_username} (#${record.actor_id})`;
	}

	return record.actor_id == null ? "n/a" : `Actor #${record.actor_id}`;
}

function scopeKey(scope: ResourceEventScope): string {
	if (scope.type === "collection") {
		return `collection:${scope.collectionId}`;
	}

	if (scope.type === "class") {
		return `class:${scope.classId}`;
	}

	return `object:${scope.classId}:${scope.objectId}`;
}

function normalizeAsOfInput(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}

	if (trimmed.includes("T") && !/[zZ]|[+-]\d\d:\d\d$/.test(trimmed)) {
		const parsed = new Date(trimmed);
		return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
	}

	return trimmed;
}

function getSnapshotValue(record: HistoryRecord): unknown {
	return {
		...record,
		actor_id: record.actor_id ?? null,
		actor_username: record.actor_username ?? null,
		valid_to: record.valid_to ?? null,
	};
}

export function ResourceActivityPanel({
	scope,
	title,
}: ResourceActivityPanelProps) {
	const stableScopeKey = useMemo(() => scopeKey(scope), [scope]);
	const [eventCursor, setEventCursor] = useState("");
	const [historyCursor, setHistoryCursor] = useState("");
	const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null);
	const [selectedHistory, setSelectedHistory] = useState<HistoryRecord | null>(
		null,
	);
	const [asOfInput, setAsOfInput] = useState("");
	const [asOfTimestamp, setAsOfTimestamp] = useState("");

	const eventsQuery = useQuery({
		queryKey: ["resource-events", stableScopeKey, eventCursor],
		queryFn: () =>
			fetchResourceEventsPage(scope, {
				cursor: eventCursor || undefined,
				limit: 20,
				sort: "-occurred_at,-id",
			}),
	});

	const historyQuery = useQuery({
		queryKey: ["resource-history", stableScopeKey, historyCursor],
		queryFn: () =>
			fetchResourceHistoryPage(scope, {
				cursor: historyCursor || undefined,
				limit: 20,
				sort: "-history_id",
			}),
	});

	const snapshotQuery = useQuery({
		queryKey: ["resource-history-as-of", stableScopeKey, asOfTimestamp],
		queryFn: () => fetchResourceHistoryAsOf(scope, asOfTimestamp),
		enabled: Boolean(asOfTimestamp),
		retry: false,
	});

	function onAsOfSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const normalized = normalizeAsOfInput(asOfInput);
		if (!normalized) {
			return;
		}

		setAsOfTimestamp(normalized);
	}

	const events = eventsQuery.data?.items ?? [];
	const selectedEventIndex = selectedEvent
		? events.findIndex((event) => event.id === selectedEvent.id)
		: -1;
	const eventExportView = {
		id: `${stableScopeKey}-audit-events`,
		fileName: `${stableScopeKey}-audit-events`,
		sheetName: "Audit events",
		columns: [
			{
				key: "time",
				label: "Time",
				getValue: (event: EventRecord) => formatTimestamp(event.occurred_at),
			},
			{
				key: "action",
				label: "Action",
				getValue: (event: EventRecord) =>
					`${event.entity_type}.${event.action}`,
			},
			{
				key: "actor",
				label: "Actor",
				getValue: (event: EventRecord) => formatActor(event),
			},
			{
				key: "summary",
				label: "Summary",
				getValue: (event: EventRecord) => event.summary,
			},
			{
				key: "event_id",
				label: "Event ID",
				getValue: (event: EventRecord) => event.event_id,
			},
		],
		rows: events,
	};
	const history = historyQuery.data?.items ?? [];
	const selectedHistoryIndex = selectedHistory
		? history.findIndex(
				(record) => record.history_id === selectedHistory.history_id,
			)
		: -1;
	const historyExportView = {
		id: `${stableScopeKey}-version-history`,
		fileName: `${stableScopeKey}-version-history`,
		sheetName: "Version history",
		columns: [
			{
				key: "version",
				label: "Version",
				getValue: (record: HistoryRecord) => `#${record.history_id}`,
			},
			{
				key: "operation",
				label: "Operation",
				getValue: (record: HistoryRecord) => record.op,
			},
			{
				key: "valid_from",
				label: "Valid from",
				getValue: (record: HistoryRecord) => formatTimestamp(record.valid_from),
			},
			{
				key: "valid_to",
				label: "Valid to",
				getValue: (record: HistoryRecord) => formatTimestamp(record.valid_to),
			},
			{
				key: "actor",
				label: "Actor",
				getValue: (record: HistoryRecord) => formatHistoryActor(record),
			},
			{
				key: "name",
				label: "Name",
				getValue: (record: HistoryRecord) => record.name,
			},
		],
		rows: history,
	};

	return (
		<article className="card stack panel-card">
			<EventDetailsModal
				event={selectedEvent}
				onClose={() => setSelectedEvent(null)}
				navigation={
					selectedEventIndex >= 0
						? {
								current: selectedEventIndex + 1,
								itemLabel: "audit event",
								onPrevious:
									selectedEventIndex > 0
										? () => setSelectedEvent(events[selectedEventIndex - 1])
										: undefined,
								onNext:
									selectedEventIndex < events.length - 1
										? () => setSelectedEvent(events[selectedEventIndex + 1])
										: undefined,
								total: events.length,
							}
						: undefined
				}
			/>
			<HistoryDetailsModal
				record={selectedHistory}
				onClose={() => setSelectedHistory(null)}
				navigation={
					selectedHistoryIndex >= 0
						? {
								current: selectedHistoryIndex + 1,
								itemLabel: "history version",
								onPrevious:
									selectedHistoryIndex > 0
										? () =>
												setSelectedHistory(history[selectedHistoryIndex - 1])
										: undefined,
								onNext:
									selectedHistoryIndex < history.length - 1
										? () =>
												setSelectedHistory(history[selectedHistoryIndex + 1])
										: undefined,
								total: history.length,
							}
						: undefined
				}
			/>
			<div className="panel-header">
				<div className="stack action-card-header">
					<h3>{title}</h3>
					<p className="muted">
						Audit events come from the append-only event stream. History rows
						show stored versions for this resource.
					</p>
				</div>
			</div>

			<section className="stack">
				<div className="panel-header">
					<div>
						<strong>Recent audit events</strong>
						<p className="muted">
							{eventsQuery.data?.totalCount == null
								? "Newest visible events for this resource."
								: `${eventsQuery.data.totalCount} visible matching events.`}
						</p>
					</div>
					<div className="action-row">
						<TableExportMenu
							view={eventExportView}
							disabled={eventsQuery.isFetching}
							compact
						/>
						<button
							type="button"
							className="secondary"
							disabled={!eventCursor || eventsQuery.isFetching}
							onClick={() => setEventCursor("")}
						>
							First page
						</button>
						<button
							type="button"
							className="secondary"
							disabled={!eventsQuery.data?.nextCursor || eventsQuery.isFetching}
							onClick={() => setEventCursor(eventsQuery.data?.nextCursor ?? "")}
						>
							Next page
						</button>
					</div>
				</div>

				{eventsQuery.isLoading ? (
					<div className="muted">Loading audit events...</div>
				) : null}
				{eventsQuery.isError ? (
					<div className="error-banner">
						Failed to load audit events.{" "}
						{eventsQuery.error instanceof Error
							? eventsQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!eventsQuery.isLoading &&
				!eventsQuery.isError &&
				(eventsQuery.data?.items.length ?? 0) === 0 ? (
					<div className="empty-state">No audit events are visible.</div>
				) : null}
				{eventsQuery.data?.items.length ? (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Time</th>
									<th>Action</th>
									<th>Actor</th>
									<th>Summary</th>
									<th>Event ID</th>
								</tr>
							</thead>
							<tbody>
								{events.map((event) => (
									<tr
										key={event.id}
										className="activity-detail-row"
										tabIndex={0}
										onClick={() => setSelectedEvent(event)}
										onKeyDown={(keyboardEvent) => {
											if (
												keyboardEvent.key === "Enter" ||
												keyboardEvent.key === " "
											) {
												keyboardEvent.preventDefault();
												setSelectedEvent(event);
											}
										}}
										aria-label={`View details for audit event ${event.event_id}`}
									>
										<td>{formatTimestamp(event.occurred_at)}</td>
										<td>
											{event.entity_type}.{event.action}
										</td>
										<td>{formatActor(event)}</td>
										<td>{event.summary}</td>
										<td>{event.event_id}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</section>

			<section className="stack">
				<div className="panel-header">
					<div>
						<strong>Version history</strong>
						<p className="muted">Stored state changes for this resource.</p>
					</div>
					<div className="action-row">
						<TableExportMenu
							view={historyExportView}
							disabled={historyQuery.isFetching}
							compact
						/>
						<button
							type="button"
							className="secondary"
							disabled={!historyCursor || historyQuery.isFetching}
							onClick={() => setHistoryCursor("")}
						>
							First page
						</button>
						<button
							type="button"
							className="secondary"
							disabled={
								!historyQuery.data?.nextCursor || historyQuery.isFetching
							}
							onClick={() =>
								setHistoryCursor(historyQuery.data?.nextCursor ?? "")
							}
						>
							Next page
						</button>
					</div>
				</div>

				{historyQuery.isLoading ? (
					<div className="muted">Loading version history...</div>
				) : null}
				{historyQuery.isError ? (
					<div className="error-banner">
						Failed to load version history.{" "}
						{historyQuery.error instanceof Error
							? historyQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!historyQuery.isLoading &&
				!historyQuery.isError &&
				(historyQuery.data?.items.length ?? 0) === 0 ? (
					<div className="empty-state">No history rows are visible.</div>
				) : null}
				{historyQuery.data?.items.length ? (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Version</th>
									<th>Operation</th>
									<th>Valid from</th>
									<th>Valid to</th>
									<th>Actor</th>
									<th>Name</th>
								</tr>
							</thead>
							<tbody>
								{history.map((record) => (
									<tr
										key={record.history_id}
										className="activity-detail-row"
										tabIndex={0}
										onClick={() => setSelectedHistory(record)}
										onKeyDown={(keyboardEvent) => {
											if (
												keyboardEvent.key === "Enter" ||
												keyboardEvent.key === " "
											) {
												keyboardEvent.preventDefault();
												setSelectedHistory(record);
											}
										}}
										aria-label={`View details for history version ${record.history_id}`}
									>
										<td>#{record.history_id}</td>
										<td>{record.op}</td>
										<td>{formatTimestamp(record.valid_from)}</td>
										<td>{formatTimestamp(record.valid_to)}</td>
										<td>{formatHistoryActor(record)}</td>
										<td>{record.name}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</section>

			<section className="stack">
				<form className="filter-form" onSubmit={onAsOfSubmit}>
					<label>
						<span>Snapshot as of</span>
						<input
							type="datetime-local"
							value={asOfInput}
							onChange={(event) => setAsOfInput(event.target.value)}
						/>
					</label>
					<button type="submit" disabled={!asOfInput.trim()}>
						Load snapshot
					</button>
				</form>

				{snapshotQuery.isFetching ? (
					<div className="muted">Loading historical snapshot...</div>
				) : null}
				{snapshotQuery.isError ? (
					<div className="error-banner">
						Failed to load snapshot.{" "}
						{snapshotQuery.error instanceof Error
							? snapshotQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{snapshotQuery.data ? (
					<div className="stack">
						<div className="task-details-grid">
							<div>
								<strong>Version</strong>
								<p className="muted">#{snapshotQuery.data.history_id}</p>
							</div>
							<div>
								<strong>Operation</strong>
								<p className="muted">{snapshotQuery.data.op}</p>
							</div>
							<div>
								<strong>Valid from</strong>
								<p className="muted">
									{formatTimestamp(snapshotQuery.data.valid_from)}
								</p>
							</div>
							<div>
								<strong>Actor</strong>
								<p className="muted">
									{formatHistoryActor(snapshotQuery.data)}
								</p>
							</div>
						</div>
						<JsonViewer value={getSnapshotValue(snapshotQuery.data)} />
					</div>
				) : null}
			</section>
		</article>
	);
}
