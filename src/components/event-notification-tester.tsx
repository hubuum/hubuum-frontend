"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
import type {
	EventNotificationRequest,
	EventSink,
} from "@/lib/api/generated/models";
import {
	previewEventNotification,
	testEventNotification,
} from "@/lib/api/system-events";
import { useConfirm } from "@/lib/confirm-context";

export function EventNotificationTester({ sinks }: { sinks: EventSink[] }) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [sinkId, setSinkId] = useState("");
	const [subscriptionId, setSubscriptionId] = useState("");
	const [eventId, setEventId] = useState("");
	const preview = useMutation({
		mutationFn: (request: EventNotificationRequest) =>
			previewEventNotification(Number(sinkId), request),
	});
	const test = useMutation({
		mutationFn: (request: EventNotificationRequest) =>
			testEventNotification(Number(sinkId), request),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["event-deliveries"] }),
	});
	const busy = preview.isPending || test.isPending;
	const valid =
		sinks.some((sink) => sink.id === Number(sinkId)) &&
		/^[1-9]\d*$/.test(subscriptionId) &&
		Number.isSafeInteger(Number(subscriptionId)) &&
		eventId.trim().length > 0;
	function reset() {
		preview.reset();
		test.reset();
	}
	function request(): EventNotificationRequest {
		return {
			event_id: eventId.trim(),
			subscription_id: Number(subscriptionId),
		};
	}
	async function sendTest() {
		if (!valid || busy) return;
		if (
			await confirm({
				title: "Send test notification?",
				description:
					"This queues a real delivery to the selected subscription's destination using the saved event.",
				confirmLabel: "Send test notification",
			})
		)
			test.mutate(request());
	}
	return (
		<section className="card stack" aria-label="Preview and test notifications">
			<h3>Preview and test notifications</h3>
			<p>
				Preview a saved event using an existing subscription. Copy its event ID
				from Audit and its subscription ID from the subscription list.
			</p>
			<form
				className="stack"
				onSubmit={(event) => {
					event.preventDefault();
					if (valid && !busy) preview.mutate(request());
				}}
			>
				<fieldset className="form-grid" disabled={busy}>
					<legend>Notification source</legend>
					<label className="control-field">
						<span>Event sink</span>
						<select
							required
							value={sinkId}
							onChange={(event) => {
								setSinkId(event.target.value);
								reset();
							}}
						>
							<option value="">Select a sink</option>
							{sinks
								.filter((sink) => sink.kind === "webhook")
								.map((sink) => (
									<option key={sink.id} value={sink.id}>
										{sink.name}
									</option>
								))}
						</select>
					</label>
					<label className="control-field">
						<span>Subscription ID</span>
						<input
							required
							inputMode="numeric"
							value={subscriptionId}
							onChange={(event) => {
								setSubscriptionId(event.target.value);
								reset();
							}}
						/>
					</label>
					<label className="control-field">
						<span>Event ID</span>
						<input
							required
							value={eventId}
							onChange={(event) => {
								setEventId(event.target.value);
								reset();
							}}
						/>
					</label>
				</fieldset>
				<div className="action-row">
					<button type="submit" disabled={!valid || busy}>
						Preview notification
					</button>
					<button
						type="button"
						className="secondary"
						disabled={!valid || busy}
						onClick={() => void sendTest()}
					>
						Send test notification
					</button>
				</div>
			</form>
			{preview.isPending ? <p role="status">Preparing preview…</p> : null}
			{preview.isError ? <p role="alert">{preview.error.message}</p> : null}
			{test.isError ? <p role="alert">{test.error.message}</p> : null}
			{preview.isSuccess ? (
				<section aria-label="Notification preview">
					<h4>Rendered payload</h4>
					<JsonViewer value={preview.data.payload} />
				</section>
			) : null}
			{test.isSuccess ? (
				<p role="status">
					Test delivery #{test.data.id} queued. Inspect its status in Recent
					deliveries.
				</p>
			) : null}
		</section>
	);
}
