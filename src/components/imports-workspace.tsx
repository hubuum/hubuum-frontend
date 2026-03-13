"use client";

import { useMutation } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createImportTask, type ImportRequest } from "@/lib/api/tasking";

type ImportSummary = {
  totalItems: number;
  sections: Array<{
    name: string;
    count: number;
  }>;
};

type ImportFilePayload = ImportRequest & Record<string, unknown>;

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function normalizeImportPayload(payload: unknown): ImportFilePayload {
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

  return candidate as ImportFilePayload;
}

export function ImportsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fileName, setFileName] = useState("");
  const [parsedImport, setParsedImport] = useState<ImportFilePayload | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [atomicity, setAtomicity] = useState<"strict" | "best_effort">("strict");
  const [collisionPolicy, setCollisionPolicy] = useState<"abort" | "overwrite">("abort");
  const [permissionPolicy, setPermissionPolicy] = useState<"abort" | "continue">("abort");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [taskLookupInput, setTaskLookupInput] = useState("");

  const importSummary = useMemo(() => (parsedImport ? summarizeImport(parsedImport) : null), [parsedImport]);

  useEffect(() => {
    const legacyTaskId = parsePositiveInteger(searchParams.get("taskId") ?? "");
    if (legacyTaskId) {
      router.replace(`/tasks/${legacyTaskId}`);
    }
  }, [router, searchParams]);

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
      router.push(`/tasks/${task.id}`);
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

    router.push(`/tasks/${parsed}`);
  }

  return (
    <section className="stack">
      <header className="stack action-card-header">
        <div className="stack action-card-header">
          <p className="eyebrow">Imports</p>
          <h2>Submit import tasks</h2>
        </div>
        <p className="muted">
          Upload a JSON import document, choose execution mode, then continue on a dedicated task page for progress, events,
          and per-item outcomes.
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
                <span className="muted">Successful submissions open a dedicated task page so you can keep multiple imports in flight.</span>
              </div>
            </form>
          </article>
        </section>

        <section className="stack">
          <article className="card stack panel-card">
            <div className="stack action-card-header">
              <h3>Open an existing task</h3>
              <p className="muted">Resume any known import task by ID without reloading an import file.</p>
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
              <h3>What happens next</h3>
            </div>
            <div className="template-help">
              <span>Submit an import here, then continue on `/tasks/[taskId]`.</span>
              <span>The task page shows status, lifecycle events, and import-specific results.</span>
              <span>Polling stops automatically when the task reaches a terminal state.</span>
            </div>
          </article>
        </section>
      </div>
    </section>
  );
}
