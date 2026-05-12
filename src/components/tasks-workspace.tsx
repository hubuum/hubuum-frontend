"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import {
	fetchTasks,
	isTerminalTaskStatus,
	summarizeTaskActivity,
	type TaskRecord,
} from "@/lib/api/tasking";

function parsePositiveInteger(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function getTaskLabel(task: Pick<TaskRecord, "kind">): string {
	if (task.kind === "import") {
		return "Import";
	}
	if (task.kind === "report") {
		return "Report";
	}

	return `${task.kind[0].toUpperCase()}${task.kind.slice(1)}`;
}

export function TasksWorkspace() {
	const router = useRouter();
	const [taskLookupInput, setTaskLookupInput] = useState("");
	const issuedTasksQuery = useQuery({
		queryKey: ["tasks", "workspace-list"],
		queryFn: async () => {
			const page = await fetchTasks({
				limit: 50,
				sort: "created_at.desc,id.desc",
			});
			return page.tasks;
		},
		refetchInterval: (query) => {
			const hasActiveTasks = (query.state.data ?? []).some(
				(task) => !isTerminalTaskStatus(task.status),
			);
			const isHidden =
				typeof document !== "undefined" &&
				document.visibilityState === "hidden";

			if (isHidden) {
				return hasActiveTasks ? 15000 : 30000;
			}

			return hasActiveTasks ? 5000 : 15000;
		},
	});
	const taskSummary = useMemo(
		() => summarizeTaskActivity(issuedTasksQuery.data ?? []),
		[issuedTasksQuery.data],
	);

	function handleLoadTask(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = parsePositiveInteger(taskLookupInput);
		if (!parsed) {
			return;
		}

		router.push(`/tasks/${parsed}`);
	}

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Tasks</p>
					<h2>Background task overview</h2>
				</div>
				<p className="muted">
					Watch task activity available to your account, then jump into a
					specific task page for detailed progress, events, and results.
				</p>
			</header>

			<div className="imports-layout">
				<section className="stack">
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Recent task activity</h3>
							<p className="muted">
								This panel polls the v1 task list automatically. Counts are based
								on the recent tasks returned for your account.
							</p>
						</div>

						{issuedTasksQuery.isLoading ? (
							<div className="muted">Loading recent task activity...</div>
						) : null}
						{issuedTasksQuery.isError ? (
							<div className="error-banner">
								Failed to load recent task activity.{" "}
								{issuedTasksQuery.error instanceof Error
									? issuedTasksQuery.error.message
									: "Unknown error"}
							</div>
						) : null}

						{!issuedTasksQuery.isLoading && !issuedTasksQuery.isError ? (
							<>
								<div className="summary-grid">
									<div className="summary-pill">
										<span>Recent active</span>
										<strong>{taskSummary.activeTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Recent queued</span>
										<strong>{taskSummary.queuedTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Recent running</span>
										<strong>{taskSummary.runningTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Recent validating</span>
										<strong>{taskSummary.validatingTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Recent failed</span>
										<strong>{taskSummary.failedTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Recent partial</span>
										<strong>{taskSummary.partiallySucceededTasks}</strong>
									</div>
								</div>

								<div className="task-details-grid">
									<div>
										<strong>Oldest queued</strong>
										<p className="muted">
											{formatTimestamp(taskSummary.oldestQueuedAt)}
										</p>
									</div>
									<div>
										<strong>Oldest active</strong>
										<p className="muted">
											{formatTimestamp(taskSummary.oldestActiveAt)}
										</p>
									</div>
									<div>
										<strong>Loaded tasks</strong>
										<p className="muted">{taskSummary.totalLoaded}</p>
									</div>
									<div>
										<strong>Scope</strong>
										<p className="muted">Your visible tasks</p>
									</div>
								</div>
							</>
						) : null}
					</article>
				</section>

				<section className="stack">
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Issued tasks</h3>
							<p className="muted">
								Recent task submissions loaded from the server. Click any row to
								reopen its detailed task page.
							</p>
						</div>

						{issuedTasksQuery.isLoading ? (
							<div className="muted">Loading recent tasks...</div>
						) : null}
						{issuedTasksQuery.isError ? (
							<div className="error-banner">
								Failed to load recent tasks.{" "}
								{issuedTasksQuery.error instanceof Error
									? issuedTasksQuery.error.message
									: "Unknown error"}
							</div>
						) : null}

						{!issuedTasksQuery.isLoading &&
						!issuedTasksQuery.isError &&
						(issuedTasksQuery.data?.length ?? 0) === 0 ? (
							<div className="empty-state">
								No recent tasks were returned by the server.
							</div>
						) : null}

						{issuedTasksQuery.data?.length ? (
							<div className="table-wrap">
								<table>
									<thead>
										<tr>
											<th>ID</th>
											<th>Kind</th>
											<th>Status</th>
											<th>Created</th>
											<th>Summary</th>
										</tr>
									</thead>
									<tbody>
										{issuedTasksQuery.data.map((task) => (
											<tr key={task.id}>
												<td>
													<Link className="row-link" href={`/tasks/${task.id}`}>
														#{task.id}
													</Link>
												</td>
												<td>{getTaskLabel(task)}</td>
												<td>{task.status}</td>
												<td>{formatTimestamp(task.created_at)}</td>
												<td>{task.summary ?? "n/a"}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : null}
					</article>

					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Open a task</h3>
							<p className="muted">
								Task pages are the detailed view. Use a known ID to jump
								directly to one.
							</p>
						</div>

						<form className="action-row" onSubmit={handleLoadTask}>
							<input
								type="number"
								min={1}
								value={taskLookupInput}
								onChange={(event) => setTaskLookupInput(event.target.value)}
								placeholder="Task ID"
							/>
							<button type="submit" className="ghost">
								Open task
							</button>
						</form>
					</article>

					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Create work</h3>
						</div>
						<div className="action-row">
							<Link className="link-chip" href="/imports">
								Submit import
							</Link>
							<Link className="link-chip" href="/reports">
								Run report
							</Link>
						</div>
					</article>
				</section>
			</div>
		</section>
	);
}
