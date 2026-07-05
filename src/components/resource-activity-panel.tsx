"use client";

import { useQuery } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
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

function formatActor(record: Pick<EventRecord, "actor_kind" | "actor_user_id">): string {
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
	if (scope.type === "namespace") {
		return `namespace:${scope.namespaceId}`;
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

	return (
		<article className="card stack panel-card">
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
							onClick={() =>
								setEventCursor(eventsQuery.data?.nextCursor ?? "")
							}
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
								{eventsQuery.data.items.map((event) => (
									<tr key={event.id}>
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
							disabled={!historyQuery.data?.nextCursor || historyQuery.isFetching}
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
								{historyQuery.data.items.map((record) => (
									<tr key={record.history_id}>
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
								<p className="muted">{formatHistoryActor(snapshotQuery.data)}</p>
							</div>
						</div>
						<JsonViewer value={getSnapshotValue(snapshotQuery.data)} />
					</div>
				) : null}
			</section>
		</article>
	);
}
