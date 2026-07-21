"use client";

import {
	CreateModal,
	type ModalRecordNavigation,
} from "@/components/create-modal";
import { JsonViewer } from "@/components/json-viewer";
import type { HistoryRecord } from "@/lib/api/events";

type HistoryDetailsModalProps = {
	record: HistoryRecord | null;
	onClose: () => void;
	navigation?: ModalRecordNavigation;
};

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "n/a";
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "long",
	}).format(parsed);
}

function formatActor(record: HistoryRecord): string {
	if (record.actor_username) {
		return record.actor_id == null
			? record.actor_username
			: `${record.actor_username} (#${record.actor_id})`;
	}

	return record.actor_id == null ? "n/a" : `Actor #${record.actor_id}`;
}

function getStoredState(record: HistoryRecord): unknown {
	return {
		...record,
		actor_id: record.actor_id ?? null,
		actor_username: record.actor_username ?? null,
		valid_to: record.valid_to ?? null,
	};
}

export function HistoryDetailsModal({
	record,
	onClose,
	navigation,
}: HistoryDetailsModalProps) {
	return (
		<CreateModal
			open={record !== null}
			title={
				record ? `History version #${record.history_id}` : "History version"
			}
			onClose={onClose}
			navigation={navigation}
		>
			{record ? (
				<div className="stack">
					<p>{record.name}</p>

					<dl className="event-detail-grid">
						<div>
							<dt>Operation</dt>
							<dd>{record.op}</dd>
						</div>
						<div>
							<dt>Resource ID</dt>
							<dd>#{record.id}</dd>
						</div>
						<div>
							<dt>Valid from</dt>
							<dd>{formatTimestamp(record.valid_from)}</dd>
						</div>
						<div>
							<dt>Valid to</dt>
							<dd>{formatTimestamp(record.valid_to)}</dd>
						</div>
						<div>
							<dt>Actor</dt>
							<dd>{formatActor(record)}</dd>
						</div>
						<div>
							<dt>Updated</dt>
							<dd>{formatTimestamp(record.updated_at)}</dd>
						</div>
					</dl>

					<section className="stack event-detail-json">
						<div>
							<h4>Stored state</h4>
							<p className="muted">
								Complete resource state recorded for this version.
							</p>
						</div>
						<JsonViewer value={getStoredState(record)} />
					</section>
				</div>
			) : null}
		</CreateModal>
	);
}
