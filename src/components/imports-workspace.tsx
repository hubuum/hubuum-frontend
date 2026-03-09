"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  createImportTask,
  fetchImportProjection,
  fetchImportResults,
  fetchTask,
  fetchTaskEvents,
  isTerminalTaskStatus,
  type ImportRequest,
  type TaskRecord
} from "@/lib/api/tasking";

type ImportSummary = {
  totalItems: number;
  sections: Array<{
    name: string;
    count: number;
  }>;
};

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatTimestamp(value: string | null): string {
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

function summarizeImport(payload: ImportRequest): ImportSummary {
  const sectionNames = [
    "namespaces",
    "classes",
    "objects",
    "class_relations",
    "object_relations",
    "namespace_permissions"
  ] as const;
  const sections = sectionNames.map((name) => ({
    name,
    count: Array.isArray(payload.graph?.[name]) ? payload.graph[name].length : 0
  }));

  return {
    totalItems: sections.reduce((sum, section) => sum + section.count, 0),
    sections
  };
}

function normalizeImportPayload(payload: unknown): ImportRequest {
  if (!payload || typeof payload !== "object") {
    throw new Error("Import file must contain a JSON object.");
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.version !== 1) {
    throw new Error("Import file must declare version 1.");
  }
  if (!candidate.graph || typeof candidate.graph !== "object" || Array.isArray(candidate.graph)) {
    throw new Error("Import file must include a graph object.");
  }

  return candidate as ImportRequest;
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

export function ImportsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fileName, setFileName] = useState("");
  const [parsedImport, setParsedImport] = useState<ImportRequest | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [atomicity, setAtomicity] = useState<"strict" | "best_effort">("strict");
  const [collisionPolicy, setCollisionPolicy] = useState<"abort" | "overwrite">("abort");
  const [permissionPolicy, setPermissionPolicy] = useState<"abort" | "continue">("abort");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [taskLookupInput, setTaskLookupInput] = useState(searchParams.get("taskId") ?? "");

  const taskId = useMemo(() => parsePositiveInteger(searchParams.get("taskId") ?? ""), [searchParams]);
  const importSummary = useMemo(() => (parsedImport ? summarizeImport(parsedImport) : null), [parsedImport]);

  useEffect(() => {
    setTaskLookupInput(searchParams.get("taskId") ?? "");
  }, [searchParams]);

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId ?? 0),
    enabled: taskId !== null,
    refetchInterval: (query) => (isTerminalTaskStatus(query.state.data?.status) ? false : 2000)
  });
  const importProjectionQuery = useQuery({
    queryKey: ["import-task", taskId],
    queryFn: () => fetchImportProjection(taskId ?? 0),
    enabled: taskId !== null
  });
  const eventsQuery = useQuery({
    queryKey: ["task-events", taskId],
    queryFn: () => fetchTaskEvents(taskId ?? 0),
    enabled: taskId !== null,
    refetchInterval: () => (isTerminalTaskStatus(taskQuery.data?.status) ? false : 2500)
  });
  const resultsQuery = useQuery({
    queryKey: ["import-results", taskId],
    queryFn: () => fetchImportResults(taskId ?? 0),
    enabled: taskId !== null,
    refetchInterval: () => (isTerminalTaskStatus(taskQuery.data?.status) ? false : 2500)
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!parsedImport) {
        throw new Error("Select a valid JSON import file before submitting.");
      }

      const payload: ImportRequest = {
        ...parsedImport,
        dry_run: dryRun,
        mode: {
          ...parsedImport.mode,
          atomicity,
          collision_policy: collisionPolicy,
          permission_policy: permissionPolicy
        }
      };

      return createImportTask(payload, idempotencyKey);
    },
    onSuccess: (task) => {
      setSubmitError(null);
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("taskId", String(task.id));
      router.replace(`/imports?${nextParams.toString()}`);
    },
    onError: (error) => {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit import.");
    }
  });

  async function handleFileChange(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = normalizeImportPayload(JSON.parse(text));
      setParsedImport(payload);
      setFileName(file.name);
      setDryRun(Boolean(payload.dry_run));
      setAtomicity(payload.mode?.atomicity ?? "strict");
      setCollisionPolicy(payload.mode?.collision_policy ?? "abort");
      setPermissionPolicy(payload.mode?.permission_policy ?? "abort");
      setParseError(null);
      setSubmitError(null);
    } catch (error) {
      setParsedImport(null);
      setFileName(file.name);
      setParseError(error instanceof Error ? error.message : "Selected file is not a valid import document.");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    submitMutation.mutate();
  }

  function handleLoadTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parsePositiveInteger(taskLookupInput);
    if (!parsed) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("taskId", String(parsed));
    router.replace(`/imports?${nextParams.toString()}`);
  }

  const activeTask = taskQuery.data ?? importProjectionQuery.data ?? null;
  const taskTone = getTaskStatusTone(activeTask);

  return (
    <section className="stack">
      <header className="stack action-card-header">
        <div className="stack action-card-header">
          <p className="eyebrow">Imports</p>
          <h2>Submit and monitor import tasks</h2>
        </div>
        <p className="muted">
          Upload a JSON import document, choose execution mode, then follow task progress, events, and per-item outcomes.
        </p>
      </header>

      <div className="imports-layout">
        <section className="stack">
          <article className="card stack panel-card">
            <div className="stack action-card-header">
              <h3>Import submission</h3>
              <p className="muted">The file stays client-side until you submit a JSON request body to the backend.</p>
            </div>

            <form className="stack" onSubmit={handleSubmit}>
              <div className="form-grid">
                <label className="control-field control-field--wide">
                  <span>Import file</span>
                  <input type="file" accept=".json,application/json" onChange={handleFileChange} />
                </label>

                <label className="control-field">
                  <span>Dry run</span>
                  <select value={dryRun ? "true" : "false"} onChange={(event) => setDryRun(event.target.value === "true")}>
                    <option value="false">Execute</option>
                    <option value="true">Validate only</option>
                  </select>
                </label>

                <label className="control-field">
                  <span>Atomicity</span>
                  <select
                    value={atomicity}
                    onChange={(event) => setAtomicity(event.target.value as "strict" | "best_effort")}
                  >
                    <option value="strict">Strict</option>
                    <option value="best_effort">Best effort</option>
                  </select>
                </label>

                <label className="control-field">
                  <span>Collision policy</span>
                  <select
                    value={collisionPolicy}
                    onChange={(event) => setCollisionPolicy(event.target.value as "abort" | "overwrite")}
                  >
                    <option value="abort">Abort</option>
                    <option value="overwrite">Overwrite</option>
                  </select>
                </label>

                <label className="control-field">
                  <span>Permission policy</span>
                  <select
                    value={permissionPolicy}
                    onChange={(event) => setPermissionPolicy(event.target.value as "abort" | "continue")}
                  >
                    <option value="abort">Abort</option>
                    <option value="continue">Continue</option>
                  </select>
                </label>

                <label className="control-field control-field--wide">
                  <span>Idempotency key</span>
                  <input
                    value={idempotencyKey}
                    onChange={(event) => setIdempotencyKey(event.target.value)}
                    placeholder="inventory-import-2026-03-07"
                  />
                </label>
              </div>

              <div className="file-summary">
                <div>
                  <strong>Selected file</strong>
                  <p className="muted">{fileName || "No file selected."}</p>
                </div>
                {importSummary ? (
                  <div className="summary-grid">
                    <div className="summary-pill">
                      <span>Total items</span>
                      <strong>{importSummary.totalItems}</strong>
                    </div>
                    {importSummary.sections.map((section) => (
                      <div key={section.name} className="summary-pill">
                        <span>{section.name.replaceAll("_", " ")}</span>
                        <strong>{section.count}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Load a valid import document to inspect section counts.</div>
                )}
              </div>

              {parseError ? <div className="error-banner">{parseError}</div> : null}
              {submitError ? <div className="error-banner">{submitError}</div> : null}

              <div className="action-row">
                <button type="submit" disabled={submitMutation.isPending || !parsedImport}>
                  {submitMutation.isPending ? "Submitting..." : "Submit import"}
                </button>
              </div>
            </form>
          </article>
        </section>

        <section className="stack">
          <article className="card stack panel-card">
            <div className="panel-header">
              <div className="stack action-card-header">
                <h3>Task monitor</h3>
                <p className="muted">Resume any known import task by task id, or follow the latest submission.</p>
              </div>
              {activeTask ? <span className={`status-pill status-pill--${taskTone}`}>{activeTask.status}</span> : null}
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
                Load task
              </button>
            </form>

            {taskQuery.isError ? (
              <div className="error-banner">
                Failed to load task. {taskQuery.error instanceof Error ? taskQuery.error.message : "Unknown error"}
              </div>
            ) : null}

            {!taskId ? <div className="empty-state">Submit an import or enter a task ID to start monitoring.</div> : null}

            {activeTask ? (
              <div className="stack">
                <div className="summary-grid">
                  <div className="summary-pill">
                    <span>Task ID</span>
                    <strong>#{activeTask.id}</strong>
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
                    <strong>Request redacted</strong>
                    <p className="muted">{formatTimestamp(activeTask.request_redacted_at)}</p>
                  </div>
                </div>

                {activeTask.summary ? <div className="info-banner">{activeTask.summary}</div> : null}
              </div>
            ) : null}
          </article>

          <article className="card stack panel-card">
            <div className="stack action-card-header">
              <h3>Lifecycle events</h3>
              <p className="muted">Append-only task history from the generic task system.</p>
            </div>

            {eventsQuery.isLoading && taskId ? <div className="muted">Loading events...</div> : null}
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

          <article className="card stack panel-card">
            <div className="stack action-card-header">
              <h3>Import results</h3>
              <p className="muted">Per-item outcomes are specific to the import domain endpoint.</p>
            </div>

            {resultsQuery.isLoading && taskId ? <div className="muted">Loading results...</div> : null}
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
                        <td>{result.item_ref ?? result.identifier}</td>
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
        </section>
      </div>
    </section>
  );
}
