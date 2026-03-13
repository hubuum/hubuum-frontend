"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { getApiV0MetaTasks } from "@/lib/api/generated/client";
import type { TaskQueueStateResponse } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

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
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

async function fetchTaskQueueState(): Promise<TaskQueueStateResponse> {
  const response = await getApiV0MetaTasks({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load task queue state."));
  }

  return response.data;
}

export function TasksWorkspace() {
  const router = useRouter();
  const [taskLookupInput, setTaskLookupInput] = useState("");
  const taskQueueQuery = useQuery({
    queryKey: ["tasks", "workspace-queue"],
    queryFn: fetchTaskQueueState,
    refetchInterval: (query) => {
      const activeTasks = query.state.data?.active_tasks ?? 0;
      const isHidden = typeof document !== "undefined" && document.visibilityState === "hidden";

      if (isHidden) {
        return activeTasks > 0 ? 15000 : 30000;
      }

      return activeTasks > 0 ? 5000 : 15000;
    }
  });

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
        <p className="muted">Watch current queue activity, then jump into a specific task page for detailed progress, events, and results.</p>
      </header>

      <div className="imports-layout">
        <section className="stack">
          <article className="card stack panel-card">
            <div className="stack action-card-header">
              <h3>Queue snapshot</h3>
              <p className="muted">This panel polls automatically. The sidebar badge uses the same queue signal and highlights recent failures.</p>
            </div>

            {taskQueueQuery.isLoading ? <div className="muted">Loading task queue state...</div> : null}
            {taskQueueQuery.isError ? (
              <div className="error-banner">
                Failed to load task queue state. {taskQueueQuery.error instanceof Error ? taskQueueQuery.error.message : "Unknown error"}
              </div>
            ) : null}

            {taskQueueQuery.data ? (
              <>
                <div className="summary-grid">
                  <div className="summary-pill">
                    <span>Active</span>
                    <strong>{taskQueueQuery.data.active_tasks}</strong>
                  </div>
                  <div className="summary-pill">
                    <span>Queued</span>
                    <strong>{taskQueueQuery.data.queued_tasks}</strong>
                  </div>
                  <div className="summary-pill">
                    <span>Running</span>
                    <strong>{taskQueueQuery.data.running_tasks}</strong>
                  </div>
                  <div className="summary-pill">
                    <span>Validating</span>
                    <strong>{taskQueueQuery.data.validating_tasks}</strong>
                  </div>
                  <div className="summary-pill">
                    <span>Failed total</span>
                    <strong>{taskQueueQuery.data.failed_tasks}</strong>
                  </div>
                  <div className="summary-pill">
                    <span>Partial total</span>
                    <strong>{taskQueueQuery.data.partially_succeeded_tasks}</strong>
                  </div>
                </div>

                <div className="task-details-grid">
                  <div>
                    <strong>Oldest queued</strong>
                    <p className="muted">{formatTimestamp(taskQueueQuery.data.oldest_queued_at)}</p>
                  </div>
                  <div>
                    <strong>Oldest active</strong>
                    <p className="muted">{formatTimestamp(taskQueueQuery.data.oldest_active_at)}</p>
                  </div>
                  <div>
                    <strong>Total task events</strong>
                    <p className="muted">{taskQueueQuery.data.total_task_events}</p>
                  </div>
                  <div>
                    <strong>Import result rows</strong>
                    <p className="muted">{taskQueueQuery.data.total_import_result_rows}</p>
                  </div>
                </div>
              </>
            ) : null}
          </article>
        </section>

        <section className="stack">
          <article className="card stack panel-card">
            <div className="stack action-card-header">
              <h3>Open a task</h3>
              <p className="muted">Task pages are the detailed view. Use a known ID to jump directly to one.</p>
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
