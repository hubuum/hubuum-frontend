"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TableExportMenu } from "@/components/table-export-menu";
import {
	fetchEventDeliveriesPage,
	fetchEventDeliveryHealth,
	fetchEventSinks,
	markEventDeliveryDead,
	retryEventDelivery,
} from "@/lib/api/events";
import type { EventDelivery, EventSink } from "@/lib/api/generated/models";
import type { TableExportColumn, TableExportView } from "@/lib/table-export";

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

function formatAgeSeconds(value: number | null | undefined): string {
	if (value == null) {
		return "n/a";
	}

	if (value < 60) {
		return `${value}s`;
	}

	const minutes = Math.floor(value / 60);
	const seconds = value % 60;
	return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function statusTone(status: string): "neutral" | "success" | "danger" | "accent" {
	if (status === "succeeded") {
		return "success";
	}
	if (status === "failed" || status === "dead") {
		return "danger";
	}
	if (status === "pending" || status === "in_flight") {
		return "accent";
	}
	return "neutral";
}

const eventSinkExportColumns: TableExportColumn<EventSink>[] = [
	{ key: "id", label: "ID", getValue: (sink) => `#${sink.id}` },
	{ key: "name", label: "Name", getValue: (sink) => sink.name },
	{ key: "kind", label: "Kind", getValue: (sink) => sink.kind },
	{
		key: "enabled",
		label: "Enabled",
		getValue: (sink) => (sink.enabled ? "yes" : "no"),
	},
	{
		key: "secret",
		label: "Secret",
		getValue: (sink) => sink.secret_ref ?? "n/a",
	},
	{
		key: "updated",
		label: "Updated",
		getValue: (sink) => formatTimestamp(sink.updated_at),
	},
];

const eventDeliveryExportColumns: TableExportColumn<EventDelivery>[] = [
	{ key: "id", label: "ID", getValue: (delivery) => `#${delivery.id}` },
	{
		key: "event",
		label: "Event",
		getValue: (delivery) => `#${delivery.event_id}`,
	},
	{
		key: "subscription",
		label: "Subscription",
		getValue: (delivery) => `#${delivery.subscription_id}`,
	},
	{ key: "status", label: "Status", getValue: (delivery) => delivery.status },
	{
		key: "attempts",
		label: "Attempts",
		getValue: (delivery) => delivery.attempts,
	},
	{
		key: "next_attempt",
		label: "Next attempt",
		getValue: (delivery) => formatTimestamp(delivery.next_attempt_at),
	},
	{
		key: "error",
		label: "Error",
		getValue: (delivery) => delivery.last_error ?? "n/a",
	},
];

export function AdminEventsWorkspace() {
	const queryClient = useQueryClient();
	const healthQuery = useQuery({
		queryKey: ["event-deliveries", "health"],
		queryFn: fetchEventDeliveryHealth,
		refetchInterval: 15000,
	});
	const deliveriesQuery = useQuery({
		queryKey: ["event-deliveries", "list"],
		queryFn: () => fetchEventDeliveriesPage(),
		refetchInterval: 15000,
	});
	const sinksQuery = useQuery({
		queryKey: ["event-sinks", "list"],
		queryFn: fetchEventSinks,
	});

	const retryMutation = useMutation({
		mutationFn: retryEventDelivery,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["event-deliveries"] });
		},
	});

	const deadMutation = useMutation({
		mutationFn: markEventDeliveryDead,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["event-deliveries"] });
		},
	});

	const health = healthQuery.data;
	const sinkExportView: TableExportView<EventSink> = {
		id: "admin.event-sinks",
		fileName: "event-sinks-view",
		sheetName: "Event sinks",
		columns: eventSinkExportColumns,
		rows: sinksQuery.data ?? [],
	};
	const deliveryExportView: TableExportView<EventDelivery> = {
		id: "admin.event-deliveries",
		fileName: "event-deliveries-view",
		sheetName: "Event deliveries",
		columns: eventDeliveryExportColumns,
		rows: deliveriesQuery.data?.items ?? [],
	};

	return (
		<section className="stack">
			<article className="card stack panel-card">
				<div className="stack action-card-header">
					<h3>Delivery health</h3>
					<p className="muted">
						Fan-out and delivery queue health from the backend event delivery
						pipeline.
					</p>
				</div>

				{healthQuery.isLoading ? (
					<div className="muted">Loading event delivery health...</div>
				) : null}
				{healthQuery.isError ? (
					<div className="error-banner">
						Failed to load delivery health.{" "}
						{healthQuery.error instanceof Error
							? healthQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{health ? (
					<div className="summary-grid">
						<div className="summary-pill">
							<span>Fan-out pending</span>
							<strong>{health.fanout.pending_events}</strong>
						</div>
						<div className="summary-pill">
							<span>Fan-out in flight</span>
							<strong>{health.fanout.in_flight_events}</strong>
						</div>
						<div className="summary-pill">
							<span>Pending deliveries</span>
							<strong>{health.delivery.counts.pending}</strong>
						</div>
						<div className="summary-pill">
							<span>Retryable</span>
							<strong>{health.delivery.counts.retryable}</strong>
						</div>
						<div className="summary-pill">
							<span>Dead</span>
							<strong>{health.delivery.counts.dead}</strong>
						</div>
						<div className="summary-pill">
							<span>Oldest due</span>
							<strong>
								{formatAgeSeconds(health.delivery.oldest_due_age_seconds)}
							</strong>
						</div>
					</div>
				) : null}
			</article>

			<article className="card stack panel-card">
				<div className="panel-header">
					<div className="stack action-card-header">
						<h3>Event sinks</h3>
						<p className="muted">
							Configured global transports. Sink configuration is shown in
							summary form; secrets remain references only.
						</p>
					</div>
					<TableExportMenu
						view={sinkExportView}
						disabled={sinksQuery.isFetching}
						compact
					/>
				</div>

				{sinksQuery.isLoading ? (
					<div className="muted">Loading event sinks...</div>
				) : null}
				{sinksQuery.isError ? (
					<div className="error-banner">
						Failed to load event sinks.{" "}
						{sinksQuery.error instanceof Error
							? sinksQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!sinksQuery.isLoading &&
				!sinksQuery.isError &&
				(sinksQuery.data?.length ?? 0) === 0 ? (
					<div className="empty-state">No event sinks configured.</div>
				) : null}
				{sinksQuery.data?.length ? (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>ID</th>
									<th>Name</th>
									<th>Kind</th>
									<th>Enabled</th>
									<th>Secret</th>
									<th>Updated</th>
								</tr>
							</thead>
							<tbody>
								{sinksQuery.data.map((sink) => (
									<tr key={sink.id}>
										<td>#{sink.id}</td>
										<td>{sink.name}</td>
										<td>{sink.kind}</td>
										<td>{sink.enabled ? "yes" : "no"}</td>
										<td>{sink.secret_ref ?? "n/a"}</td>
										<td>{formatTimestamp(sink.updated_at)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</article>

			<article className="card stack panel-card">
				<div className="panel-header">
					<div className="stack action-card-header">
						<h3>Recent deliveries</h3>
						<p className="muted">
							Retry failed rows or move rows to dead-letter state when they
							should no longer be attempted.
						</p>
					</div>
					<TableExportMenu
						view={deliveryExportView}
						disabled={deliveriesQuery.isFetching}
						compact
					/>
				</div>

				{deliveriesQuery.isLoading ? (
					<div className="muted">Loading deliveries...</div>
				) : null}
				{deliveriesQuery.isError ? (
					<div className="error-banner">
						Failed to load deliveries.{" "}
						{deliveriesQuery.error instanceof Error
							? deliveriesQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{retryMutation.isError ? (
					<div className="error-banner">
						Failed to retry delivery.{" "}
						{retryMutation.error instanceof Error
							? retryMutation.error.message
							: "Unknown error"}
					</div>
				) : null}
				{deadMutation.isError ? (
					<div className="error-banner">
						Failed to mark delivery dead.{" "}
						{deadMutation.error instanceof Error
							? deadMutation.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!deliveriesQuery.isLoading &&
				!deliveriesQuery.isError &&
				(deliveriesQuery.data?.items.length ?? 0) === 0 ? (
					<div className="empty-state">No deliveries returned.</div>
				) : null}
				{deliveriesQuery.data?.items.length ? (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>ID</th>
									<th>Event</th>
									<th>Subscription</th>
									<th>Status</th>
									<th>Attempts</th>
									<th>Next attempt</th>
									<th>Error</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{deliveriesQuery.data.items.map((delivery) => {
									const actionPending =
										retryMutation.isPending || deadMutation.isPending;
									return (
										<tr key={delivery.id}>
											<td>#{delivery.id}</td>
											<td>#{delivery.event_id}</td>
											<td>#{delivery.subscription_id}</td>
											<td>
												<span
													className={`status-pill status-pill--${statusTone(delivery.status)}`}
												>
													{delivery.status}
												</span>
											</td>
											<td>{delivery.attempts}</td>
											<td>{formatTimestamp(delivery.next_attempt_at)}</td>
											<td>{delivery.last_error ?? "n/a"}</td>
											<td>
												<div className="table-tools">
													<button
														type="button"
														className="ghost"
														disabled={actionPending}
														onClick={() => retryMutation.mutate(delivery.id)}
													>
														Retry
													</button>
													<button
														type="button"
														className="danger"
														disabled={actionPending}
														onClick={() => deadMutation.mutate(delivery.id)}
													>
														Dead
													</button>
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : null}
			</article>
		</section>
	);
}
