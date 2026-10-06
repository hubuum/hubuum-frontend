"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
	deleteCollectionEventSink,
	fetchCollectionEventSinks,
	saveCollectionEventSink,
} from "@/lib/api/events";
import type {
	CollectionEventSink,
	NewEventSink,
	UpdateEventSink,
} from "@/lib/api/generated/models";
import { useConfirm } from "@/lib/confirm-context";
import {
	collectionWebhookConfig,
	WEBHOOK_TARGET_LABELS,
	WEBHOOK_TARGETS,
	type WebhookTarget,
} from "@/lib/webhook-presets";

type Props = { collectionId: number; canManage: boolean; canExport: boolean };

export function CollectionEventSinksPanel({
	collectionId,
	canManage,
	canExport,
}: Props) {
	const client = useQueryClient();
	const confirm = useConfirm();
	const [editing, setEditing] = useState<CollectionEventSink | "new" | null>(
		null,
	);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [target, setTarget] = useState<WebhookTarget>("custom");
	const [enabled, setEnabled] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const query = useQuery({
		queryKey: ["collection-event-sinks", collectionId],
		queryFn: () => fetchCollectionEventSinks(collectionId),
		enabled: canManage,
	});
	const refresh = () =>
		client.invalidateQueries({
			queryKey: ["collection-event-sinks", collectionId],
		});
	const save = useMutation({
		mutationFn: (payload: NewEventSink | UpdateEventSink) =>
			saveCollectionEventSink(
				collectionId,
				payload,
				editing && editing !== "new" ? editing.id : undefined,
			),
		onSuccess: async () => {
			setEditing(null);
			setUrl("");
			await refresh();
		},
	});
	const remove = useMutation({
		mutationFn: (id: number) => deleteCollectionEventSink(collectionId, id),
		onSuccess: refresh,
	});
	if (!canManage) return null;
	function open(sink: CollectionEventSink | "new") {
		setEditing(sink);
		setName(sink === "new" ? "" : sink.name);
		setUrl("");
		setEnabled(sink === "new" ? true : sink.enabled);
		setTarget("custom");
		setError(null);
		save.reset();
	}
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		if (!canExport || !editing) return;
		try {
			if (!name.trim()) throw new Error("Enter a destination name.");
			if (editing === "new") {
				save.mutate({
					name: name.trim(),
					kind: "webhook",
					enabled,
					config: collectionWebhookConfig(target, url),
				});
			} else {
				save.mutate({
					name: name.trim(),
					enabled,
					...(url.trim()
						? { config: collectionWebhookConfig(target, url) }
						: {}),
				});
			}
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Check the webhook settings.",
			);
		}
	}
	return (
		<section
			className="card stack"
			aria-labelledby="collection-destinations-title"
		>
			<header className="toolbar">
				<div className="stack">
					<h3 id="collection-destinations-title">Webhook destinations</h3>
					<p className="muted">
						Manage destinations owned by this collection, then choose one in an
						event subscription.
					</p>
				</div>
				<button
					type="button"
					className="secondary"
					disabled={!canExport || editing !== null}
					onClick={() => open("new")}
				>
					New webhook destination
				</button>
			</header>
			{!canExport ? (
				<p className="muted">
					Read audit permission is required to create or edit destinations.
				</p>
			) : null}
			{query.isError ? (
				<p className="error-banner">{query.error.message}</p>
			) : null}
			{remove.isError ? (
				<p className="error-banner">{remove.error.message}</p>
			) : null}
			{editing ? (
				<form
					className="stack"
					onSubmit={submit}
					aria-label="Collection webhook destination"
				>
					<h4>
						{editing === "new"
							? "Create webhook destination"
							: "Edit webhook destination"}
					</h4>
					<label className="field">
						<span>Destination name</span>
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							required
						/>
					</label>
					<label className="field">
						<span>Webhook target</span>
						<select
							value={target}
							onChange={(event) =>
								setTarget(event.target.value as WebhookTarget)
							}
						>
							{WEBHOOK_TARGETS.map((value) => (
								<option key={value} value={value}>
									{WEBHOOK_TARGET_LABELS[value]}
								</option>
							))}
						</select>
					</label>
					<label className="field">
						<span>
							{editing === "new"
								? "Destination URL"
								: "Replacement destination URL"}
						</span>
						<input
							type="url"
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							required={editing === "new"}
							autoComplete="off"
							placeholder="https://…"
						/>
					</label>
					{editing !== "new" ? (
						<p className="muted">
							Leave the URL blank to keep the existing destination and message
							format. Supplying a replacement applies the selected webhook
							target.
						</p>
					) : null}
					<label className="checkbox">
						<input
							type="checkbox"
							checked={enabled}
							onChange={(event) => setEnabled(event.target.checked)}
						/>
						Enabled
					</label>
					{error || save.isError ? (
						<p role="alert" className="error-banner">
							{error ?? save.error?.message}
						</p>
					) : null}
					<div className="action-row">
						<button type="submit" disabled={save.isPending || !canExport}>
							{save.isPending ? "Saving…" : "Save destination"}
						</button>
						<button
							type="button"
							className="secondary"
							disabled={save.isPending}
							onClick={() => {
								setEditing(null);
								setUrl("");
							}}
						>
							Cancel
						</button>
					</div>
				</form>
			) : null}
			{query.isLoading ? <p className="muted">Loading destinations…</p> : null}
			{query.data?.length === 0 ? (
				<p className="empty-state">
					No destinations are available yet. Create a webhook destination to get
					started.
				</p>
			) : null}
			{query.data?.length ? (
				<div className="table-scroll">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Type</th>
								<th>Access</th>
								<th>Status</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{query.data.map((sink) => (
								<tr key={sink.id}>
									<td>{sink.name}</td>
									<td>{sink.kind}</td>
									<td>
										{sink.collection_id === collectionId
											? "Owned by this collection"
											: "Shared by administrator"}
									</td>
									<td>{sink.enabled ? "Enabled" : "Disabled"}</td>
									<td>
										{sink.collection_id === collectionId ? (
											<div className="action-row">
												<button
													type="button"
													className="secondary"
													disabled={!canExport || editing !== null}
													onClick={() => open(sink)}
												>
													Edit
												</button>
												<button
													type="button"
													className="secondary"
													disabled={remove.isPending}
													onClick={async () => {
														if (
															await confirm({
																title: `Delete ${sink.name}?`,
																description:
																	"Remove this destination's subscriptions before deleting it.",
																confirmLabel: "Delete",
																tone: "danger",
															})
														)
															remove.mutate(sink.id);
													}}
												>
													Delete
												</button>
											</div>
										) : (
											<span className="muted">Administrator managed</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</section>
	);
}
