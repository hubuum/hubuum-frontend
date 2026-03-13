"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  fetchImportProjection,
  fetchImportResults,
  fetchTask,
  fetchTaskEvents,
  isTerminalTaskStatus,
  type TaskRecord
} from "@/lib/api/tasking";
import { upsertRecentTask } from "@/lib/recent-tasks";

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
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getTaskStatusTone(task: TaskRecord | null | undefined): "neutral" | "success" | "danger" | "accent" {
  if (!task) {
    return "neutral";
  }
  if (task.status === "succeeded") {
    return "success";
  }
  if (task.status === "failed" || task.status === "cancelled") {
    return "danger";
  }
  if (task.status === "partially_succeeded") {
    return "accent";
  }
  return "neutral";
}

function getTaskHeading(task: TaskRecord | null, taskId: number): string {
  if (!task) {
    return `Task #${taskId}`;
  }

  if (task.kind === "import") {
    return `Import task #${task.id}`;
  }
  if (task.kind === "report") {
    return `Report task #${task.id}`;
  }

  return `${task.kind[0].toUpperCase()}${task.kind.slice(1)} task #${task.id}`;
}

export function TaskDetail({ taskId }: TaskDetailProps) {
  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId),
    refetchInterval: (query) => (isTerminalTaskStatus(query.state.data?.status) ? false : 2000)
  });

  const importProjectionQuery = useQuery({
    queryKey: ["import-task", taskId],
    queryFn: () => fetchImportProjection(taskId),
    enabled: taskQuery.data?.kind === "import",
    refetchInterval: () => (isTerminalTaskStatus(taskQuery.data?.status) ? false : 2000)
  });

  const eventsQuery = useQuery({
    queryKey: ["task-events", taskId],
    queryFn: () => fetchTaskEvents(taskId),
    enabled: taskQuery.isSuccess,
    refetchInterval: () => (isTerminalTaskStatus(taskQuery.data?.status) ? false : 2500)
  });

  const resultsQuery = useQuery({
    queryKey: ["import-results", taskId],
    queryFn: () => fetchImportResults(taskId),
    enabled: taskQuery.data?.kind === "import",
    refetchInterval: () => (isTerminalTaskStatus(taskQuery.data?.status) ? false : 2500)
  });

  useEffect(() => {
    if (!taskQuery.data) {
      return;
    }

    upsertRecentTask(taskQuery.data, { onlyIfExists: true });
  }, [taskQuery.data]);

  if (taskQuery.isLoading) {
    return <div className="card">Loading task...</div>;
  }

  if (taskQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load task. {taskQuery.error instanceof Error ? taskQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const activeTask = importProjectionQuery.data ?? taskQuery.data ?? null;
  const taskTone = getTaskStatusTone(activeTask);
  const isImportTask = activeTask?.kind === "import";
  const backHref = activeTask?.kind === "report" ? "/reports" : "/imports";
  const backLabel = activeTask?.kind === "report" ? "Back to reports" : "Back to imports";

  if (!activeTask) {
    return <div className="card error-banner">Task data is unavailable.</div>;
  }

  return (
    <section className="stack">
      <header className="stack action-card-header">
        <div className="stack action-card-header">
          <p className="eyebrow">Tasks</p>
          <h2>{getTaskHeading(activeTask, taskId)}</h2>
        </div>
        <p className="muted">Follow progress, inspect lifecycle events, and review import-specific outcomes when available.</p>
      </header>

      <article className="card stack panel-card">
        <div className="panel-header">
          <div className="stack action-card-header">
            <h3>Task summary</h3>
            <p className="muted">This page keeps polling while the task is active, then stops automatically once it reaches a terminal state.</p>
          </div>
          <div className="action-row">
            <span className={`status-pill status-pill--${taskTone}`}>{activeTask.status}</span>
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
            <span>Processed</span>
            <strong>
              {activeTask.progress.processed_items} / {activeTask.progress.total_items}
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
            <p className="muted">{activeTask.submitted_by ?? "n/a"}</p>
          </div>
          <div>
            <strong>Request redacted</strong>
            <p className="muted">{formatTimestamp(activeTask.request_redacted_at)}</p>
          </div>
          <div>
            <strong>Events URL</strong>
            <p className="muted">{activeTask.links.events}</p>
          </div>
        </div>

        {activeTask.summary ? <div className="info-banner">{activeTask.summary}</div> : null}
        {importProjectionQuery.isError ? (
          <div className="error-banner">
            Failed to load import-specific task details.{" "}
            {importProjectionQuery.error instanceof Error ? importProjectionQuery.error.message : "Unknown error"}
          </div>
        ) : null}
      </article>

      <article className="card stack panel-card">
        <div className="stack action-card-header">
          <h3>Lifecycle events</h3>
          <p className="muted">Append-only task history from the generic task system.</p>
        </div>

        {eventsQuery.isLoading ? <div className="muted">Loading events...</div> : null}
        {eventsQuery.isError ? (
          <div className="error-banner">
            Failed to load events. {eventsQuery.error instanceof Error ? eventsQuery.error.message : "Unknown error"}
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
                </tr>
              </thead>
              <tbody>
                {eventsQuery.data.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTimestamp(event.created_at)}</td>
                    <td>{event.event_type}</td>
                    <td>{event.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      {isImportTask ? (
        <article className="card stack panel-card">
          <div className="stack action-card-header">
            <h3>Import results</h3>
            <p className="muted">Per-item outcomes are available for import tasks once validation or execution begins producing results.</p>
          </div>

          {resultsQuery.isLoading ? <div className="muted">Loading results...</div> : null}
          {resultsQuery.isError ? (
            <div className="error-banner">
              Failed to load results. {resultsQuery.error instanceof Error ? resultsQuery.error.message : "Unknown error"}
            </div>
          ) : null}
          {!resultsQuery.isLoading && (resultsQuery.data?.length ?? 0) === 0 ? (
            <div className="empty-state">No per-item results available yet.</div>
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
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {resultsQuery.data.map((result) => (
                    <tr key={result.id}>
                      <td>{result.item_ref ?? result.identifier ?? "n/a"}</td>
                      <td>{result.entity_kind}</td>
                      <td>{result.action}</td>
                      <td>{result.outcome}</td>
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
