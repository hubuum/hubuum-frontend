"use client";

import { useQuery } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { fetchEventsPage, type EventListOptions } from "@/lib/api/events";

function parseOptionalNumber(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

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

function formatActor(actorKind: string, actorUserId: number | null | undefined): string {
	if (actorUserId == null) {
		return actorKind;
	}

	return `${actorKind} #${actorUserId}`;
}

export function AuditWorkspace() {
	const [cursor, setCursor] = useState("");
	const [filters, setFilters] = useState<EventListOptions>({
		limit: 50,
		sort: "-occurred_at,-id",
	});
	const [entityType, setEntityType] = useState("");
	const [entityId, setEntityId] = useState("");
	const [namespaceId, setNamespaceId] = useState("");
	const [action, setAction] = useState("");
	const [actorKind, setActorKind] = useState("");
	const [actorUserId, setActorUserId] = useState("");
	const [occurredAfter, setOccurredAfter] = useState("");
	const [occurredBefore, setOccurredBefore] = useState("");

	const eventsQuery = useQuery({
		queryKey: ["events", "audit-workspace", filters, cursor],
		queryFn: () =>
			fetchEventsPage({
				...filters,
				cursor: cursor || undefined,
			}),
	});

	function onFilterSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setCursor("");
		setFilters({
			limit: 50,
			sort: "-occurred_at,-id",
			entity_type: entityType.trim() || undefined,
			entity_id: parseOptionalNumber(entityId),
			namespace_id: parseOptionalNumber(namespaceId),
			action: action.trim() || undefined,
			actor_kind: actorKind.trim() || undefined,
			actor_user_id: parseOptionalNumber(actorUserId),
			occurred_after: occurredAfter.trim() || undefined,
			occurred_before: occurredBefore.trim() || undefined,
		});
	}

	function clearFilters() {
		setCursor("");
		setEntityType("");
		setEntityId("");
		setNamespaceId("");
		setAction("");
		setActorKind("");
		setActorUserId("");
		setOccurredAfter("");
		setOccurredBefore("");
		setFilters({ limit: 50, sort: "-occurred_at,-id" });
	}

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Audit</p>
					<h2>Event stream</h2>
				</div>
				<p className="muted">
					Browse visible audit events from the backend event stream. Results are
					scoped by your account and namespace permissions.
				</p>
			</header>

			<article className="card stack panel-card">
				<form className="filter-form" onSubmit={onFilterSubmit}>
					<label>
						<span>Entity type</span>
						<input
							value={entityType}
							onChange={(event) => setEntityType(event.target.value)}
							placeholder="namespace, class, object"
						/>
					</label>
					<label>
						<span>Entity ID</span>
						<input
							value={entityId}
							onChange={(event) => setEntityId(event.target.value)}
							inputMode="numeric"
						/>
					</label>
					<label>
						<span>Namespace ID</span>
						<input
							value={namespaceId}
							onChange={(event) => setNamespaceId(event.target.value)}
							inputMode="numeric"
						/>
					</label>
					<label>
						<span>Action</span>
						<input
							value={action}
							onChange={(event) => setAction(event.target.value)}
							placeholder="created, updated, deleted"
						/>
					</label>
					<label>
						<span>Actor kind</span>
						<input
							value={actorKind}
							onChange={(event) => setActorKind(event.target.value)}
							placeholder="user, system, worker"
						/>
					</label>
					<label>
						<span>Actor ID</span>
						<input
							value={actorUserId}
							onChange={(event) => setActorUserId(event.target.value)}
							inputMode="numeric"
						/>
					</label>
					<label>
						<span>After</span>
						<input
							type="date"
							value={occurredAfter}
							onChange={(event) => setOccurredAfter(event.target.value)}
						/>
					</label>
					<label>
						<span>Before</span>
						<input
							type="date"
							value={occurredBefore}
							onChange={(event) => setOccurredBefore(event.target.value)}
						/>
					</label>
					<button type="submit">Apply filters</button>
					<button type="button" className="ghost" onClick={clearFilters}>
						Clear
					</button>
				</form>
			</article>

			<article className="card stack panel-card">
				<div className="panel-header">
					<div className="stack action-card-header">
						<h3>Events</h3>
						<p className="muted">
							{eventsQuery.data?.totalCount == null
								? "Newest visible audit events."
								: `${eventsQuery.data.totalCount} matching events.`}
						</p>
					</div>
					<div className="action-row">
						<button
							type="button"
							className="secondary"
							disabled={!cursor || eventsQuery.isFetching}
							onClick={() => setCursor("")}
						>
							First page
						</button>
						<button
							type="button"
							className="secondary"
							disabled={!eventsQuery.data?.nextCursor || eventsQuery.isFetching}
							onClick={() => setCursor(eventsQuery.data?.nextCursor ?? "")}
						>
							Next page
						</button>
					</div>
				</div>

				{eventsQuery.isLoading ? (
					<div className="muted">Loading events...</div>
				) : null}
				{eventsQuery.isError ? (
					<div className="error-banner">
						Failed to load events.{" "}
						{eventsQuery.error instanceof Error
							? eventsQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!eventsQuery.isLoading &&
				!eventsQuery.isError &&
				(eventsQuery.data?.items.length ?? 0) === 0 ? (
					<div className="empty-state">No events match these filters.</div>
				) : null}
				{eventsQuery.data?.items.length ? (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Time</th>
									<th>Entity</th>
									<th>Action</th>
									<th>Actor</th>
									<th>Namespace</th>
									<th>Summary</th>
									<th>Correlation</th>
								</tr>
							</thead>
							<tbody>
								{eventsQuery.data.items.map((event) => (
									<tr key={event.id}>
										<td>{formatTimestamp(event.occurred_at)}</td>
										<td>
											{event.entity_type}
											{event.entity_id == null ? "" : ` #${event.entity_id}`}
											{event.entity_name ? ` / ${event.entity_name}` : ""}
										</td>
										<td>{event.action}</td>
										<td>{formatActor(event.actor_kind, event.actor_user_id)}</td>
										<td>{event.namespace_id ?? "n/a"}</td>
										<td>{event.summary}</td>
										<td>{event.correlation_id ?? "n/a"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</article>
		</section>
	);
}
