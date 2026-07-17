"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { JsonEditor } from "@/components/json-editor";
import { TableExportMenu } from "@/components/table-export-menu";
import {
	createEventSink,
	deleteEventSink,
	fetchEventDeliveriesPage,
	fetchEventDeliveryHealth,
	fetchEventSinks,
	markEventDeliveryDead,
	retryEventDelivery,
	updateEventSink,
} from "@/lib/api/events";
import type {
	EventDelivery,
	EventSink,
	EventSinkKind,
	NewEventSink,
} from "@/lib/api/generated/models";
import { useConfirm } from "@/lib/confirm-context";
import {
	buildEventSinkPayload,
	defaultEventSinkFormState,
	EVENT_SINK_KINDS,
	eventSinkToFormState,
	type EventSinkFormState,
} from "@/lib/event-sink-form";
import type { TableExportColumn, TableExportView } from "@/lib/table-export";

type SinkFormMode = "create" | "edit";

function formatSinkKind(kind: EventSinkKind): string {
	return kind.replaceAll("_", " ");
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

function statusTone(
	status: string,
): "neutral" | "success" | "danger" | "accent" {
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
	const confirm = useConfirm();
	const [sinkFormMode, setSinkFormMode] = useState<SinkFormMode>("create");
	const [editingSink, setEditingSink] = useState<EventSink | null>(null);
	const [isSinkModalOpen, setSinkModalOpen] = useState(false);
	const [sinkForm, setSinkForm] = useState<EventSinkFormState>(
		defaultEventSinkFormState,
	);
	const [sinkFormError, setSinkFormError] = useState<string | null>(null);
	const [sinkMessage, setSinkMessage] = useState<string | null>(null);
	const [sinkTableError, setSinkTableError] = useState<string | null>(null);
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

	const createSinkMutation = useMutation({
		mutationFn: createEventSink,
		onSuccess: async (sink) => {
			await queryClient.invalidateQueries({ queryKey: ["event-sinks"] });
			setSinkModalOpen(false);
			setSinkMessage(`Event sink "${sink.name}" created.`);
			setSinkTableError(null);
		},
		onError: (error) => {
			setSinkFormError(
				error instanceof Error ? error.message : "Failed to create event sink.",
			);
		},
	});

	const updateSinkMutation = useMutation({
		mutationFn: ({
			payload,
			sinkId,
		}: {
			payload: NewEventSink;
			sinkId: number;
		}) => updateEventSink(sinkId, payload),
		onSuccess: async (sink) => {
			await queryClient.invalidateQueries({ queryKey: ["event-sinks"] });
			setSinkModalOpen(false);
			setSinkMessage(`Event sink "${sink.name}" updated.`);
			setSinkTableError(null);
		},
		onError: (error) => {
			setSinkFormError(
				error instanceof Error ? error.message : "Failed to update event sink.",
			);
		},
	});

	const deleteSinkMutation = useMutation({
		mutationFn: (sink: EventSink) => deleteEventSink(sink.id),
		onSuccess: async (_, sink) => {
			await queryClient.invalidateQueries({ queryKey: ["event-sinks"] });
			setSinkMessage(`Event sink "${sink.name}" deleted.`);
			setSinkTableError(null);
		},
		onError: (error) => {
			setSinkMessage(null);
			setSinkTableError(
				error instanceof Error ? error.message : "Failed to delete event sink.",
			);
		},
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

	function openCreateSink() {
		setSinkFormMode("create");
		setEditingSink(null);
		setSinkForm(defaultEventSinkFormState);
		setSinkFormError(null);
		setSinkModalOpen(true);
	}

	function openEditSink(sink: EventSink) {
		setSinkFormMode("edit");
		setEditingSink(sink);
		setSinkForm(eventSinkToFormState(sink));
		setSinkFormError(null);
		setSinkModalOpen(true);
	}

	function onSinkSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSinkFormError(null);
		setSinkMessage(null);

		let payload: NewEventSink;
		try {
			payload = buildEventSinkPayload(sinkForm);
		} catch (error) {
			setSinkFormError(
				error instanceof Error ? error.message : "Invalid event sink data.",
			);
			return;
		}

		if (sinkFormMode === "edit" && editingSink) {
			updateSinkMutation.mutate({ sinkId: editingSink.id, payload });
			return;
		}

		createSinkMutation.mutate(payload);
	}

	async function onDeleteSink(sink: EventSink) {
		setSinkMessage(null);
		setSinkTableError(null);
		const confirmed = await confirm({
			title: "Delete event sink?",
			description: `Delete "${sink.name}"? Existing subscriptions may need to be removed before the backend allows deletion.`,
			confirmLabel: "Delete sink",
			tone: "danger",
		});
		if (confirmed) {
			deleteSinkMutation.mutate(sink);
		}
	}

	const isSavingSink =
		createSinkMutation.isPending || updateSinkMutation.isPending;

	return (
		<section className="stack">
			<CreateModal
				open={isSinkModalOpen}
				title={
					sinkFormMode === "edit" ? "Edit event sink" : "Create event sink"
				}
				onClose={() => setSinkModalOpen(false)}
			>
				<form className="stack" onSubmit={onSinkSubmit}>
					<div className="form-grid">
						<label className="control-field control-field--wide">
							<span>Name</span>
							<input
								required
								value={sinkForm.name}
								onChange={(event) =>
									setSinkForm((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder="Operations webhook"
							/>
						</label>

						<label className="control-field">
							<span>Kind</span>
							<select
								value={sinkForm.kind}
								onChange={(event) =>
									setSinkForm((current) => ({
										...current,
										kind: event.target.value as EventSinkKind,
									}))
								}
							>
								{EVENT_SINK_KINDS.map((kind) => (
									<option key={kind} value={kind}>
										{formatSinkKind(kind)}
									</option>
								))}
							</select>
						</label>

						<label className="control-field">
							<span>Secret reference</span>
							<input
								value={sinkForm.secretRef}
								onChange={(event) =>
									setSinkForm((current) => ({
										...current,
										secretRef: event.target.value,
									}))
								}
								placeholder="event-webhook-secret"
							/>
							<span className="field-note">
								Reference an externally managed secret; do not enter secret
								values.
							</span>
						</label>
					</div>

					<JsonEditor
						id="event-sink-config"
						label="Configuration JSON"
						value={sinkForm.configInput}
						onChange={(configInput) =>
							setSinkForm((current) => ({ ...current, configInput }))
						}
						mode="data"
						rows={9}
						disabled={isSavingSink}
						helperText="Transport-specific configuration is validated by the backend."
					/>

					<label className="control-check">
						<input
							type="checkbox"
							checked={sinkForm.enabled}
							onChange={(event) =>
								setSinkForm((current) => ({
									...current,
									enabled: event.target.checked,
								}))
							}
						/>
						<span>Enabled</span>
					</label>

					{sinkFormError ? (
						<div className="error-banner">{sinkFormError}</div>
					) : null}

					<div className="form-actions">
						<button type="submit" disabled={isSavingSink}>
							{isSavingSink
								? "Saving..."
								: sinkFormMode === "edit"
									? "Save sink"
									: "Create sink"}
						</button>
						<button
							type="button"
							className="ghost"
							onClick={() => setSinkModalOpen(false)}
							disabled={isSavingSink}
						>
							Cancel
						</button>
					</div>
				</form>
			</CreateModal>

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
							Create and manage global transports. Configuration is editable as
							JSON; secrets remain references only.
						</p>
					</div>
					<div className="action-row">
						<TableExportMenu
							view={sinkExportView}
							disabled={sinksQuery.isFetching}
							compact
						/>
						<button type="button" onClick={openCreateSink}>
							Create sink
						</button>
					</div>
				</div>

				{sinkMessage ? <div className="info-banner">{sinkMessage}</div> : null}
				{sinkTableError ? (
					<div className="error-banner">{sinkTableError}</div>
				) : null}

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
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{sinksQuery.data.map((sink) => (
									<tr key={sink.id}>
										<td>#{sink.id}</td>
										<td>{sink.name}</td>
										<td>{formatSinkKind(sink.kind)}</td>
										<td>{sink.enabled ? "yes" : "no"}</td>
										<td>{sink.secret_ref ?? "n/a"}</td>
										<td>{formatTimestamp(sink.updated_at)}</td>
										<td>
											<div className="table-tools">
												<button
													type="button"
													className="ghost"
													onClick={() => openEditSink(sink)}
													disabled={deleteSinkMutation.isPending}
												>
													Edit
												</button>
												<button
													type="button"
													className="danger"
													onClick={() => onDeleteSink(sink)}
													disabled={deleteSinkMutation.isPending}
												>
													Delete
												</button>
											</div>
										</td>
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
