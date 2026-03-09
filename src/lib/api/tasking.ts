import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";

export type ImportMode = {
  atomicity?: "strict" | "best_effort";
  collision_policy?: "abort" | "overwrite";
  permission_policy?: "abort" | "continue";
};

export type ImportGraph = {
  namespaces?: unknown[];
  classes?: unknown[];
  objects?: unknown[];
  class_relations?: unknown[];
  object_relations?: unknown[];
  namespace_permissions?: unknown[];
} & Record<string, unknown>;

export type ImportRequest = {
  version: number;
  dry_run?: boolean;
  mode?: ImportMode;
  graph: ImportGraph;
} & Record<string, unknown>;

export type TaskKind = "import" | "report" | "export" | "reindex";
export type TaskStatus =
  | "queued"
  | "validating"
  | "running"
  | "succeeded"
  | "failed"
  | "partially_succeeded"
  | "cancelled";

export type TaskRecord = {
  id: number;
  kind: TaskKind;
  status: TaskStatus;
  submitted_by: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  progress: {
    total_items: number;
    processed_items: number;
    success_items: number;
    failed_items: number;
  };
  summary: string | null;
  request_redacted_at: string | null;
  links: {
    task: string;
    events: string;
    import: string | null;
    import_results: string | null;
  };
  details?: {
    import?: {
      results_url: string;
    } | null;
  } | null;
};

export type TaskEvent = {
  id: number;
  task_id: number;
  event_type: string;
  message: string;
  data: Record<string, unknown> | null;
  created_at: string;
};

export type ImportResult = {
  id: number;
  task_id: number;
  item_ref: string | null;
  entity_kind: string;
  action: string;
  identifier: string;
  outcome: string;
  error: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type TaskQueueStateResponse = {
  actix_workers: number;
  configured_task_workers: number;
  task_poll_interval_ms: number;
  total_tasks: number;
  queued_tasks: number;
  validating_tasks: number;
  running_tasks: number;
  active_tasks: number;
  succeeded_tasks: number;
  failed_tasks: number;
  partially_succeeded_tasks: number;
  cancelled_tasks: number;
  import_tasks: number;
  report_tasks: number;
  export_tasks: number;
  reindex_tasks: number;
  total_task_events: number;
  total_import_result_rows: number;
  oldest_queued_at: string | null;
  oldest_active_at: string | null;
};

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  return text || null;
}

async function requestJson<T>(path: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init
  });
  const payload = await parseBody(response);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, fallbackMessage));
  }

  return payload as T;
}

export function isTerminalTaskStatus(status: TaskStatus | null | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "partially_succeeded" || status === "cancelled";
}

export async function createImportTask(payload: ImportRequest, idempotencyKey?: string): Promise<TaskRecord> {
  const headers = new Headers({
    "Content-Type": "application/json"
  });

  if (idempotencyKey?.trim()) {
    headers.set("Idempotency-Key", idempotencyKey.trim());
  }

  return requestJson<TaskRecord>("/api/v1/imports", "Failed to submit import.", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

export async function fetchTask(taskId: number): Promise<TaskRecord> {
  return requestJson<TaskRecord>(`/api/v1/tasks/${taskId}`, "Failed to load task state.");
}

export async function fetchTaskEvents(taskId: number): Promise<TaskEvent[]> {
  const payload = await requestJson<unknown>(`/api/v1/tasks/${taskId}/events`, "Failed to load task events.");
  return expectArrayPayload<TaskEvent>(payload, "task events");
}

export async function fetchImportProjection(taskId: number): Promise<TaskRecord> {
  return requestJson<TaskRecord>(`/api/v1/imports/${taskId}`, "Failed to load import task.");
}

export async function fetchImportResults(taskId: number): Promise<ImportResult[]> {
  const payload = await requestJson<unknown>(`/api/v1/imports/${taskId}/results`, "Failed to load import results.");
  return expectArrayPayload<ImportResult>(payload, "import results");
}
