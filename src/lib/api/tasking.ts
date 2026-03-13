import {
  getApiV1ImportsByTaskId,
  getApiV1ImportsByTaskIdResults,
  getApiV1TasksByTaskId,
  getApiV1TasksByTaskIdEvents,
  postApiV1Imports
} from "@/lib/api/generated/client";
import type {
  ImportRequest,
  ImportTaskResultResponse,
  TaskEventResponse,
  TaskQueueStateResponse,
  TaskResponse,
  TaskStatus
} from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

export type {
  ImportRequest,
  ImportTaskResultResponse as ImportResult,
  TaskEventResponse as TaskEvent,
  TaskQueueStateResponse,
  TaskResponse as TaskRecord,
  TaskStatus
};

export function isTerminalTaskStatus(status: TaskStatus | null | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "partially_succeeded" || status === "cancelled";
}

export async function createImportTask(payload: ImportRequest, idempotencyKey?: string): Promise<TaskResponse> {
  const headers = new Headers();

  if (idempotencyKey?.trim()) {
    headers.set("Idempotency-Key", idempotencyKey.trim());
  }

  const response = await postApiV1Imports(payload, {
    credentials: "include",
    headers
  });

  if (response.status !== 202) {
    throw new Error(getApiErrorMessage(response.data, "Failed to submit import."));
  }

  return response.data;
}

export async function fetchTask(taskId: number): Promise<TaskResponse> {
  const response = await getApiV1TasksByTaskId(taskId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load task state."));
  }

  return response.data;
}

export async function fetchTaskEvents(taskId: number): Promise<TaskEventResponse[]> {
  const response = await getApiV1TasksByTaskIdEvents(taskId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load task events."));
  }

  return response.data;
}

export async function fetchImportProjection(taskId: number): Promise<TaskResponse> {
  const response = await getApiV1ImportsByTaskId(taskId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load import task."));
  }

  return response.data;
}

export async function fetchImportResults(taskId: number): Promise<ImportTaskResultResponse[]> {
  const response = await getApiV1ImportsByTaskIdResults(taskId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load import results."));
  }

  return response.data;
}
