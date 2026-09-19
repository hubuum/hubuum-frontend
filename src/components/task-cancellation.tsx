"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import {
	cancelTask,
	isTerminalTaskStatus,
	taskCancelReasonError,
	type TaskRecord,
} from "@/lib/api/tasking";
import { useConfirm } from "@/lib/confirm-context";

const consequences: Record<TaskRecord["kind"], string> = {
	import:
		"Strict imports roll back uncommitted work. Best-effort imports keep committed items and report the unattempted remainder.",
	export:
		"Querying and rendering stop at checkpoints. A cancelled export publishes no partial output.",
	backup: "Backup capture stops at checkpoints and discards incomplete output.",
	reindex:
		"Committed batches remain. Class materialization stays incomplete until a later rebuild finishes.",
	remote_call:
		"A dispatched request may already have affected the remote system. Cancellation cannot undo those effects. Review the remote system before submitting replacement work.",
	schema_validation:
		"Completed batches remain. Further schema work stops without changing the active schema or repairing objects.",
};

export function TaskCancellation({ task }: { task: TaskRecord }) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const reasonId = useId();
	const [reason, setReason] = useState("");
	const [confirming, setConfirming] = useState(false);
	const pending = useRef(false);
	const invalidReason = taskCancelReasonError(reason);
	const cancellation = useMutation({
		mutationFn: (expectedStatus: "queued" | undefined) =>
			cancelTask(task.id, {
				...(reason ? { reason } : {}),
				...(expectedStatus ? { expected_status: expectedStatus } : {}),
			}),
		onSuccess: async (updated) => {
			await queryClient.cancelQueries({ queryKey: ["task", task.id] });
			queryClient.setQueryData(["task", task.id], updated);
		},
		onSettled: async () => {
			await Promise.all(
				[
					["task", task.id],
					["task-events", task.id],
					["import-task", task.id],
					["import-results", task.id],
					["tasks"],
					["schema"],
				].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
			);
		},
	});

	async function requestCancellation() {
		if (pending.current) return;
		pending.current = true;
		setConfirming(true);
		const expectedStatus = task.status === "queued" ? "queued" : undefined;
		try {
			const accepted = await confirm({
				title: `Cancel task #${task.id}?`,
				description: `${consequences[task.kind]} ${expectedStatus ? "Withdrawal only proceeds if the task is still queued." : "Running work stops after the executor acknowledges cleanup."}`,
				confirmLabel: "Request cancellation",
				cancelLabel: "Keep task",
				tone: "danger",
			});
			if (accepted) await cancellation.mutateAsync(expectedStatus);
		} catch {
			// The mutation error remains visible below, including authorization and status conflicts.
		} finally {
			pending.current = false;
			setConfirming(false);
		}
	}

	const terminal = isTerminalTaskStatus(task.status);
	return (
		<section className="stack" aria-label="Task cancellation">
			{task.cancel_requested_at && !terminal ? (
				<p className="info-banner" role="status">
					Cancellation requested. Waiting for executor cleanup; the task is
					still {task.status}.
				</p>
			) : null}
			{!terminal && !task.cancel_requested_at ? (
				<>
					<label htmlFor={reasonId}>Cancellation reason (optional)</label>
					<input
						id={reasonId}
						value={reason}
						disabled={confirming}
						onChange={(event) => setReason(event.target.value)}
						aria-invalid={Boolean(invalidReason)}
						aria-describedby={invalidReason ? `${reasonId}-error` : undefined}
					/>
					{invalidReason ? (
						<p id={`${reasonId}-error`} role="alert">
							{invalidReason}
						</p>
					) : null}
					<div className="action-row">
						<button
							type="button"
							className="danger"
							disabled={confirming || Boolean(invalidReason)}
							onClick={() => void requestCancellation()}
						>
							{confirming ? "Requesting cancellation…" : "Cancel task"}
						</button>
					</div>
				</>
			) : null}
			{cancellation.isError ? (
				<p className="error-banner" role="alert">
					{cancellation.error.message}
				</p>
			) : null}
			{task.status === "cancelled" ? (
				<p className="muted">{consequences[task.kind]}</p>
			) : null}
		</section>
	);
}
