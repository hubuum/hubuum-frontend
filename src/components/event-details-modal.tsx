"use client";

import { CreateModal } from "@/components/create-modal";
import { JsonViewer } from "@/components/json-viewer";
import type { EventRecord } from "@/lib/api/events";
import { buildJsonDifference, formatJsonDifference } from "@/lib/json-diff";

type EventDetailsModalProps = {
	event: EventRecord | null;
	onClose: () => void;
};

function formatTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "long",
	}).format(parsed);
}

function formatActor(event: EventRecord): string {
	if (event.actor_user_id == null) {
		return event.actor_kind;
	}

	return `${event.actor_kind} #${event.actor_user_id}`;
}

function formatEntity(event: EventRecord): string {
	return `${event.entity_type}${
		event.entity_id == null ? "" : ` #${event.entity_id}`
	}${event.entity_name ? ` / ${event.entity_name}` : ""}`;
}

function EventJsonSection({ label, value }: { label: string; value: unknown }) {
	return (
		<section className="stack event-detail-json">
			<h4>{label}</h4>
			{value === undefined ? (
				<p className="muted">Not recorded for this event.</p>
			) : (
				<JsonViewer value={value} />
			)}
		</section>
	);
}

function EventChangeComparison({
	after,
	before,
}: {
	after: unknown;
	before: unknown;
}) {
	const difference = buildJsonDifference(before, after);

	return (
		<section className="stack event-diff-section">
			<div className="event-diff-summary">
				<div>
					<h4>State changes</h4>
					<p className="muted">
						Only changed branches are shown. JSON-encoded values are expanded
						when possible.
					</p>
				</div>
				{difference ? (
					<span className="status-pill">
						{difference.changeCount}{" "}
						{difference.changeCount === 1 ? "change" : "changes"}
					</span>
				) : null}
			</div>

			{before === undefined && after === undefined ? (
				<div className="empty-state">
					No before or after state was recorded for this event.
				</div>
			) : !difference ? (
				<div className="empty-state">Before and after are identical.</div>
			) : (
				<div className="event-diff-json">
					<pre>{formatJsonDifference(difference.value)}</pre>
				</div>
			)}
		</section>
	);
}

export function EventDetailsModal({ event, onClose }: EventDetailsModalProps) {
	return (
		<CreateModal
			open={event !== null}
			title={event ? `Audit event #${event.id}` : "Audit event"}
			onClose={onClose}
		>
			{event ? (
				<div className="stack">
					<p>{event.summary}</p>

					<dl className="event-detail-grid">
						<div>
							<dt>Occurred</dt>
							<dd>{formatTimestamp(event.occurred_at)}</dd>
						</div>
						<div>
							<dt>Action</dt>
							<dd>{event.action}</dd>
						</div>
						<div>
							<dt>Entity</dt>
							<dd>{formatEntity(event)}</dd>
						</div>
						<div>
							<dt>Actor</dt>
							<dd>{formatActor(event)}</dd>
						</div>
						<div>
							<dt>Collection</dt>
							<dd>
								{event.collection_id == null
									? "n/a"
									: `#${event.collection_id}`}
							</dd>
						</div>
						<div>
							<dt>Schema version</dt>
							<dd>{event.schema_version}</dd>
						</div>
						<div>
							<dt>Event ID</dt>
							<dd>
								<code>{event.event_id}</code>
							</dd>
						</div>
						<div>
							<dt>Request ID</dt>
							<dd>
								<code>{event.request_id ?? "n/a"}</code>
							</dd>
						</div>
						<div>
							<dt>Correlation ID</dt>
							<dd>
								<code>{event.correlation_id ?? "n/a"}</code>
							</dd>
						</div>
					</dl>

					<EventChangeComparison before={event.before} after={event.after} />

					<details className="event-detail-raw">
						<summary>View complete before and after payloads</summary>
						<div className="event-detail-payloads">
							<EventJsonSection label="Before" value={event.before} />
							<EventJsonSection label="After" value={event.after} />
						</div>
					</details>
					<EventJsonSection label="Metadata" value={event.metadata} />
				</div>
			) : null}
		</CreateModal>
	);
}
