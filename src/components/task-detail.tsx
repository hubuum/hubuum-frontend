"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";
import { TableExportMenu } from "@/components/table-export-menu";
import { TaskCancellation } from "@/components/task-cancellation";
import { TaskDiscoveryDetails } from "@/components/task-discovery-details";
import { getApiV1IamUsersByUserId } from "@/lib/api/generated/client";
import { formatEventActor, formatEventInitiator } from "@/lib/event-provenance";
import { taskOutputHref } from "@/lib/task-metadata";
import {
	fetchImportProjection,
	fetchImportResults,
	fetchTask,
	fetchTaskEvents,
	formatTaskElapsedTime,
	getImportUnattemptedCount,
	getTaskStatusTone,
	isTerminalTaskStatus,
	type TaskRecord,
} from "@/lib/api/tasking";
import { trackRecentItem } from "@/lib/recent-items";

async function fetchTaskSubmitter(
	userId: number,
): Promise<{ id: number; name: string } | null> {
	const response = await getApiV1IamUsersByUserId(userId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		return null;
	}

	return {
		id: response.data.id,
		name: response.data.name,
	};
}

type TaskDetailProps = {
	taskId: number;
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

function getTaskHeading(task: TaskRecord | null, taskId: number): string {
	if (!task) {
		return `Task #${taskId}`;
	}

	if (task.kind === "import") {
		return `Import task #${task.id}`;
	}
	if (task.kind === "export") {
		return `Export task #${task.id}`;
	}
	if (task.kind === "remote_call") {
		return `Remote invocation task #${task.id}`;
	}
	if (task.kind === "schema_validation") {
		return `Schema validation task #${task.id}`;
	}

	return `${task.kind[0].toUpperCase()}${task.kind.slice(1)} task #${task.id}`;
}

export function TaskDetail({ taskId }: TaskDetailProps) {
	const queryClient = useQueryClient();
	const taskQuery = useQuery({
		queryKey: ["task", taskId],
		queryFn: () => fetchTask(taskId),
		refetchInterval: (query) =>
			isTerminalTaskStatus(query.state.data?.status) ? false : 2000,
	});

	const importProjectionQuery = useQuery({
		queryKey: ["import-task", taskId],
		queryFn: () => fetchImportProjection(taskId),
		enabled: taskQuery.data?.kind === "import",
		refetchInterval: () =>
			isTerminalTaskStatus(taskQuery.data?.status) ? false : 2000,
	});

	const eventsQuery = useQuery({
		queryKey: ["task-events", taskId],
		queryFn: () => fetchTaskEvents(taskId),
		enabled: taskQuery.isSuccess,
		refetchInterval: () =>
			isTerminalTaskStatus(taskQuery.data?.status) ? false : 2500,
	});

	const resultsQuery = useQuery({
		queryKey: ["import-results", taskId],
		queryFn: () => fetchImportResults(taskId),
		enabled: taskQuery.data?.kind === "import",
		refetchInterval: () =>
			isTerminalTaskStatus(taskQuery.data?.status) ? false : 2500,
	});
	const submittedByUserId =
		importProjectionQuery.data?.submitted_by ??
		taskQuery.data?.submitted_by ??
		null;
	const submitterQuery = useQuery({
		queryKey: ["task-submitter", submittedByUserId],
		queryFn: () => fetchTaskSubmitter(submittedByUserId as number),
		enabled: submittedByUserId != null,
	});

	const status = taskQuery.data?.status;
	useEffect(() => {
		if (!isTerminalTaskStatus(status)) return;
		// Polling stops at completion; fetch the final receipts and cleanup event once.
		for (const key of ["task-events", "import-results", "import-task"]) {
			void queryClient.invalidateQueries({ queryKey: [key, taskId] });
		}
	}, [queryClient, status, taskId]);

	useEffect(() => {
		const task = taskQuery.data;
		if (!task) {
			return;
		}

		trackRecentItem({
			type: "task",
			id: task.id,
			name: getTaskHeading(task, task.id),
		});
	}, [taskQuery.data]);

	if (taskQuery.isLoading) {
		return <div className="card">Loading task...</div>;
	}

	if (taskQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load task.{" "}
				{taskQuery.error instanceof Error
					? taskQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const activeTask = taskQuery.data ?? null;
	const taskTone = getTaskStatusTone(activeTask?.status);
	const isImportTask = activeTask?.kind === "import";
	const exportDetails = activeTask?.details?.export ?? null;
	const elapsedTimeAsOf = Math.max(
		taskQuery.dataUpdatedAt,
		importProjectionQuery.dataUpdatedAt,
	);
	const backHref =
		activeTask?.kind === "export"
			? "/exports"
			: activeTask?.kind === "import"
				? "/imports"
				: "/tasks";
	const backLabel =
		activeTask?.kind === "export"
			? "Back to exports"
			: activeTask?.kind === "import"
				? "Back to imports"
				: "Back to tasks";

	if (!activeTask) {
		return <div className="card error-banner">Task data is unavailable.</div>;
	}

	const taskEvents = eventsQuery.data ?? [];
	const taskEventsExportView = {
		id: `task-${taskId}-lifecycle-events`,
		fileName: `task-${taskId}-lifecycle-events`,
		sheetName: "Lifecycle events",
		columns: [
			{
				key: "time",
				label: "Time",
				getValue: (event: (typeof taskEvents)[number]) =>
					formatTimestamp(event.created_at),
			},
			{
				key: "event",
				label: "Event",
				getValue: (event: (typeof taskEvents)[number]) => event.event_type,
			},
			{
				key: "message",
				label: "Message",
				getValue: (event: (typeof taskEvents)[number]) => event.message,
			},
			{
				key: "actor",
				label: "Actor",
				getValue: (event: (typeof taskEvents)[number]) =>
					formatEventActor(event),
			},
			{
				key: "initiator",
				label: "Initiator",
				getValue: (event: (typeof taskEvents)[number]) =>
					formatEventInitiator(event),
			},
		],
		rows: taskEvents,
	};
	const importResults = resultsQuery.data ?? [];
	const importResultsExportView = {
		id: `task-${taskId}-import-results`,
		fileName: `task-${taskId}-import-results`,
		sheetName: "Import results",
		columns: [
			{
				key: "item",
				label: "Item",
				getValue: (result: (typeof importResults)[number]) =>
					result.item_ref ?? result.identifier ?? "n/a",
			},
			{
				key: "entity",
				label: "Entity",
				getValue: (result: (typeof importResults)[number]) =>
					result.entity_kind,
			},
			{
				key: "action",
				label: "Action",
				getValue: (result: (typeof importResults)[number]) => result.action,
			},
			{
				key: "outcome",
				label: "Outcome",
				getValue: (result: (typeof importResults)[number]) => result.outcome,
			},
			{
				key: "unattempted",
				label: "Unattempted items",
				getValue: (result: (typeof importResults)[number]) =>
					getImportUnattemptedCount(result),
			},
			{
				key: "error",
				label: "Error",
				getValue: (result: (typeof importResults)[number]) =>
					result.error ?? "n/a",
			},
		],
		rows: importResults,
	};

	let submittedByLabel = "n/a";
	if (submittedByUserId != null) {
		submittedByLabel = `User #${submittedByUserId}`;

		if (submitterQuery.isLoading) {
			submittedByLabel = `Loading user #${submittedByUserId}...`;
		} else if (submitterQuery.data) {
			submittedByLabel = `${submitterQuery.data.name} (#${submitterQuery.data.id})`;
		}
	}

	return (
		<section className="stack">
			<header className="detail-identity">
				<h2>{getTaskHeading(activeTask, taskId)}</h2>
				<p className="muted">
					Follow progress, inspect lifecycle events, and review import-specific
					outcomes when available.
				</p>
			</header>

			<article className="card stack panel-card">
				<div className="panel-header">
					<div className="stack action-card-header">
						<h3>Task summary</h3>
						<p className="muted">
							This page keeps polling while the task is active, then stops
							automatically once it reaches a terminal state.
						</p>
					</div>
					<div className="action-row">
						<span className={`status-pill status-pill--${taskTone}`}>
							{activeTask.status}
						</span>
						{taskOutputHref(activeTask) ? (
							<Link
								className="link-chip"
								href={taskOutputHref(activeTask) ?? ""}
								target="_blank"
								rel="noopener noreferrer"
								prefetch={false}
							>
								{activeTask.kind === "backup"
									? "Download backup"
									: "Open result in new tab"}
							</Link>
						) : null}
						<Link className="link-chip" href={backHref}>
							{backLabel}
						</Link>
					</div>
				</div>

				<div className="summary-grid">
					<div className="summary-pill">
						<span>Task ID</span>
						<strong>#{activeTask.id}</strong>
					</div>
					<div className="summary-pill">
						<span>Kind</span>
						<strong>{activeTask.kind}</strong>
					</div>
					<div className="summary-pill">
						<span>Elapsed time</span>
						<strong>
							{formatTaskElapsedTime(activeTask, elapsedTimeAsOf)}
						</strong>
					</div>
					<div className="summary-pill">
						<span>Processed</span>
						<strong>
							{activeTask.progress.processed_items} /{" "}
							{activeTask.progress.total_items}
						</strong>
					</div>
					<div className="summary-pill">
						<span>Succeeded</span>
						<strong>{activeTask.progress.success_items}</strong>
					</div>
					<div className="summary-pill">
						<span>Failed</span>
						<strong>{activeTask.progress.failed_items}</strong>
					</div>
					{isTerminalTaskStatus(activeTask.status) ? (
						<div className="summary-pill">
							<span>Unattempted</span>
							<strong>{activeTask.unattempted_items ?? "n/a"}</strong>
						</div>
					) : null}
				</div>

				<div className="task-details-grid">
					<div>
						<strong>Created</strong>
						<p className="muted">{formatTimestamp(activeTask.created_at)}</p>
					</div>
					<div>
						<strong>Started</strong>
						<p className="muted">{formatTimestamp(activeTask.started_at)}</p>
					</div>
					<div>
						<strong>Finished</strong>
						<p className="muted">{formatTimestamp(activeTask.finished_at)}</p>
					</div>
					<div>
						<strong>Submitted by</strong>
						<p className="muted">{submittedByLabel}</p>
					</div>
					<div>
						<strong>Execution deadline</strong>
						<p className="muted">
							{formatTimestamp(activeTask.execution_deadline_at)}
						</p>
					</div>
					{activeTask.terminal_reason ? (
						<div>
							<strong>Completion reason</strong>
							<p className="muted">
								{activeTask.terminal_reason === "deadline_exceeded"
									? "Execution deadline exceeded"
									: activeTask.terminal_reason === "cancel_requested"
										? "Cancellation requested"
										: activeTask.terminal_reason}
							</p>
						</div>
					) : null}
					{activeTask.cancel_requested_at ? (
						<>
							<div>
								<strong>Cancellation requested</strong>
								<p className="muted">
									{formatTimestamp(activeTask.cancel_requested_at)}
								</p>
							</div>
							<div>
								<strong>Requested by</strong>
								<p className="muted">
									{activeTask.cancel_requested_by == null
										? "Unavailable"
										: `Principal #${activeTask.cancel_requested_by}`}
								</p>
							</div>
							<div>
								<strong>Cancellation reason</strong>
								<p className="muted">
									{activeTask.cancel_reason ?? "No reason supplied"}
								</p>
							</div>
						</>
					) : null}
					{activeTask.kind === "remote_call" ? (
						<div>
							<strong>Remote dispatch</strong>
							<p className="muted">
								{activeTask.remote_side_effect_state === "not_sent"
									? "Not sent"
									: activeTask.remote_side_effect_state === "possibly_sent"
										? "Possibly sent; external effects may have occurred"
										: "Unknown; no retained dispatch evidence"}
							</p>
						</div>
					) : null}
					<div>
						<strong>Request redacted</strong>
						<p className="muted">
							{formatTimestamp(activeTask.request_redacted_at)}
						</p>
					</div>
					<div>
						<strong>Events URL</strong>
						<p className="muted">{activeTask.links.events}</p>
					</div>
					{activeTask.kind === "export" ? (
						<>
							<div>
								<strong>Output available</strong>
								<p className="muted">
									{exportDetails == null
										? "Unknown"
										: exportDetails.output_available
											? "yes"
											: "no"}
								</p>
							</div>
							<div>
								<strong>Output type</strong>
								<p className="muted">
									{exportDetails?.output_content_type ?? "n/a"}
								</p>
							</div>
							<div>
								<strong>Template</strong>
								<p className="muted">{exportDetails?.template_name ?? "n/a"}</p>
							</div>
							<div>
								<strong>Warnings</strong>
								<p className="muted">{exportDetails?.warning_count ?? "n/a"}</p>
							</div>
							<div>
								<strong>Truncated</strong>
								<p className="muted">
									{exportDetails?.truncated == null
										? "n/a"
										: exportDetails.truncated
											? "yes"
											: "no"}
								</p>
							</div>
							<div>
								<strong>Output expires</strong>
								<p className="muted">
									{formatTimestamp(exportDetails?.output_expires_at)}
								</p>
							</div>
						</>
					) : null}
				</div>

				{activeTask.summary ? (
					<div className="info-banner">{activeTask.summary}</div>
				) : null}
				<TaskCancellation key={activeTask.id} task={activeTask} />
				{importProjectionQuery.isError ? (
					<div className="error-banner">
						Failed to load import-specific task details.{" "}
						{importProjectionQuery.error instanceof Error
							? importProjectionQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
			</article>

			<TaskDiscoveryDetails task={activeTask} />

			<article className="card stack panel-card">
				<div className="panel-header">
					<div className="stack action-card-header">
						<h3>Lifecycle events</h3>
						<p className="muted">
							Append-only task history from the generic task system.
						</p>
					</div>
					<TableExportMenu
						view={taskEventsExportView}
						disabled={eventsQuery.isFetching}
						compact
					/>
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
				{!eventsQuery.isLoading && (eventsQuery.data?.length ?? 0) === 0 ? (
					<div className="empty-state">No task events available yet.</div>
				) : null}
				{eventsQuery.data?.length ? (
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Time</th>
									<th>Event</th>
									<th>Message</th>
									<th>Actor</th>
									<th>Initiator</th>
								</tr>
							</thead>
							<tbody>
								{taskEvents.map((event) => (
									<tr key={event.id}>
										<td>{formatTimestamp(event.created_at)}</td>
										<td>{event.event_type}</td>
										<td>{event.message}</td>
										<td>{formatEventActor(event)}</td>
										<td>{formatEventInitiator(event)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</article>

			{isImportTask ? (
				<article className="card stack panel-card">
					<div className="panel-header">
						<div className="stack action-card-header">
							<h3>Import results</h3>
							<p className="muted">
								Per-item outcomes are available for import tasks once validation
								or execution begins producing results.
							</p>
						</div>
						<TableExportMenu
							view={importResultsExportView}
							disabled={resultsQuery.isFetching}
							compact
						/>
					</div>

					{resultsQuery.isLoading ? (
						<div className="muted">Loading results...</div>
					) : null}
					{resultsQuery.isError ? (
						<div className="error-banner">
							Failed to load results.{" "}
							{resultsQuery.error instanceof Error
								? resultsQuery.error.message
								: "Unknown error"}
						</div>
					) : null}
					{!resultsQuery.isLoading && (resultsQuery.data?.length ?? 0) === 0 ? (
						<div className="empty-state">
							No per-item results available yet.
						</div>
					) : null}
					{resultsQuery.data?.length ? (
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>Item</th>
										<th>Entity</th>
										<th>Action</th>
										<th>Outcome</th>
										<th>Unattempted items</th>
										<th>Error</th>
									</tr>
								</thead>
								<tbody>
									{importResults.map((result) => (
										<tr key={result.id}>
											<td>{result.item_ref ?? result.identifier ?? "n/a"}</td>
											<td>{result.entity_kind}</td>
											<td>{result.action}</td>
											<td>{result.outcome}</td>
											<td>{getImportUnattemptedCount(result) ?? "—"}</td>
											<td>{result.error ?? "n/a"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : null}
				</article>
			) : null}
		</section>
	);
}
