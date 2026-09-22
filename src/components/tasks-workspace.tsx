"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { TableExportMenu } from "@/components/table-export-menu";
import {
	fetchTasks,
	isTerminalTaskStatus,
	summarizeTaskActivity,
	type TaskRecord,
} from "@/lib/api/tasking";
import { TablePagination } from "@/components/table-pagination";
import { TaskSearchFilters } from "@/components/task-search-filters";
import {
	defaultTaskSort,
	parseTaskFilters,
	taskSortError,
} from "@/lib/task-discovery";
import { useCursorPagination } from "@/lib/use-cursor-pagination";

function parsePositiveInteger(value: string): number | null {
	const parsed = Number(value);
	return /^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed > 0
		? parsed
		: null;
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
	if (task.kind === "schema_validation") return "Schema validation";
	if (task.kind === "import") {
		return "Import";
	}
	if (task.kind === "export") {
		return "Export";
	}
	if (task.kind === "remote_call") {
		return "Remote invocation";
	}

	return `${task.kind[0].toUpperCase()}${task.kind.slice(1)}`;
}

type TasksWorkspaceProps = {
	currentUserId: number | null;
};

export function TasksWorkspace({ currentUserId }: TasksWorkspaceProps) {
	const router = useRouter();
	const search = useSearchParams().toString();
	const params = new URLSearchParams(search);
	const scope = params.get("scope") === "all" ? "all" : "mine";
	const sort = params.get("sort") ?? defaultTaskSort;
	const { filters, errors } = parseTaskFilters(params);
	const sortError = taskSortError(sort);
	if (sortError) errors.push(sortError);
	if (scope === "mine" && filters.submitted_by != null)
		errors.push("Select All visible tasks to filter by a submitter ID.");
	const pagination = useCursorPagination({ defaultLimit: 50 });
	const canSearch =
		!errors.length && (scope === "all" || currentUserId != null);
	const filterKey = new URLSearchParams(params);
	filterKey.delete("cursor");
	const [taskLookupInput, setTaskLookupInput] = useState("");
	const issuedTasksQuery = useQuery({
		queryKey: [
			"tasks",
			"workspace-list",
			currentUserId,
			scope,
			filters,
			sort,
			pagination.cursor,
			pagination.limit,
		],
		queryFn: () =>
			fetchTasks({
				filters,
				submittedBy:
					scope === "mine" ? (currentUserId ?? undefined) : undefined,
				cursor: pagination.cursor,
				limit: pagination.limit,
				sort,
			}),
		enabled: canSearch,
		refetchInterval: (query) => {
			const hasActiveTasks = (query.state.data?.tasks ?? []).some(
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
		() => summarizeTaskActivity(issuedTasksQuery.data?.tasks ?? []),
		[issuedTasksQuery.data],
	);
	const issuedTasks = canSearch ? (issuedTasksQuery.data?.tasks ?? []) : [];
	const issuedTasksExportView = {
		id: "tasks-issued",
		fileName: "issued-tasks",
		sheetName: "Issued tasks",
		columns: [
			{
				key: "id",
				label: "ID",
				getValue: (task: TaskRecord) => `#${task.id}`,
			},
			{
				key: "kind",
				label: "Kind",
				getValue: (task: TaskRecord) => getTaskLabel(task),
			},
			{
				key: "status",
				label: "Status",
				getValue: (task: TaskRecord) => task.status,
			},
			{
				key: "created",
				label: "Created",
				getValue: (task: TaskRecord) => formatTimestamp(task.created_at),
			},
			{
				key: "summary",
				label: "Summary",
				getValue: (task: TaskRecord) => task.summary ?? "n/a",
			},
		],
		rows: issuedTasks,
	};

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
					<h2>Background task overview</h2>
				</div>
				<p className="muted">
					Watch task activity available to your account, then jump into a
					specific task page for detailed progress, events, and results.
				</p>
			</header>

			<TaskSearchFilters
				key={filterKey.toString()}
				search={search}
				limit={pagination.limit}
				errors={errors}
				onApply={(next) =>
					router.push(`/tasks?${next.toString()}`, { scroll: false })
				}
			/>
			{scope === "mine" && currentUserId == null ? (
				<div className="error-banner" role="alert">
					Your account ID could not be loaded. Reload the page or select All
					visible tasks to use the server’s access scope.
				</div>
			) : null}
			<div className="imports-layout">
				<section className="stack">
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Activity on this page</h3>
							<p className="muted">
								Counts cover the current page of matching tasks and refresh
								automatically.
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

						{canSearch &&
						!issuedTasksQuery.isLoading &&
						!issuedTasksQuery.isError ? (
							<>
								<div className="summary-grid">
									<div className="summary-pill">
										<span>Active</span>
										<strong>{taskSummary.activeTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Queued</span>
										<strong>{taskSummary.queuedTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Running</span>
										<strong>{taskSummary.runningTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Validating</span>
										<strong>{taskSummary.validatingTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Failed</span>
										<strong>{taskSummary.failedTasks}</strong>
									</div>
									<div className="summary-pill">
										<span>Partial</span>
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
										<p className="muted">
											{scope === "mine"
												? "My matching tasks"
												: "All visible matching tasks"}
										</p>
									</div>
								</div>
							</>
						) : null}
					</article>
				</section>

				<section className="stack">
					<article className="card stack panel-card">
						<div className="panel-header">
							<div className="stack action-card-header">
								<h3>Issued tasks</h3>
								<p className="muted">
									Matching submissions from the server. Open a task to inspect
									its details.
								</p>
							</div>
							<TableExportMenu
								view={issuedTasksExportView}
								disabled={issuedTasksQuery.isFetching}
								compact
							/>
						</div>

						<label className="control-field">
							Tasks per page
							<select
								value={pagination.limit}
								onChange={(event) =>
									pagination.setLimit(Number(event.target.value))
								}
							>
								{[...new Set([20, 50, 100, 250, pagination.limit])]
									.sort((a, b) => a - b)
									.map((limit) => (
										<option key={limit} value={limit}>
											{limit}
										</option>
									))}
							</select>
						</label>
						{pagination.cursor && !pagination.hasPrevPage ? (
							<button
								type="button"
								className="ghost"
								onClick={pagination.goToFirstPage}
							>
								Return to first page
							</button>
						) : null}
						<TablePagination
							hasNextPage={
								canSearch && Boolean(issuedTasksQuery.data?.nextCursor)
							}
							hasPrevPage={pagination.hasPrevPage}
							onNextPage={() => {
								if (issuedTasksQuery.data?.nextCursor)
									pagination.goToNextPage(issuedTasksQuery.data.nextCursor);
							}}
							onPrevPage={() => pagination.goToPrevPage()}
							onFirstPage={pagination.goToFirstPage}
							currentCount={issuedTasks.length}
							busy={issuedTasksQuery.isFetching || !canSearch}
						/>

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

						{canSearch &&
						!issuedTasksQuery.isLoading &&
						!issuedTasksQuery.isError &&
						issuedTasks.length === 0 ? (
							<div className="empty-state">No tasks match these filters.</div>
						) : null}

						{issuedTasks.length ? (
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
										{issuedTasks.map((task) => (
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
								aria-label="Task ID"
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
							<Link className="link-chip" href="/exports">
								Run export
							</Link>
						</div>
					</article>
				</section>
			</div>
		</section>
	);
}
