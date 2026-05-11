import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1ImportsByTaskId,
	getApiV1ImportsByTaskIdResults,
	getApiV1TasksByTaskId,
	getApiV1TasksByTaskIdEvents,
	postApiV1Imports,
} from "@/lib/api/generated/client";
import type {
	ImportRequest,
	ImportTaskResultResponse,
	TaskEventResponse,
	TaskKind,
	TaskQueueStateResponse,
	TaskResponse,
	TaskStatus,
} from "@/lib/api/generated/models";

export type {
	ImportRequest,
	ImportTaskResultResponse as ImportResult,
	TaskEventResponse as TaskEvent,
	TaskKind,
	TaskQueueStateResponse,
	TaskResponse as TaskRecord,
	TaskStatus,
};

type FetchTasksOptions = {
	cursor?: string;
	kind?: TaskKind;
	limit?: number;
	sort?: string;
	status?: TaskStatus;
	submittedBy?: number;
};

export type TaskListPage = {
	nextCursor: string | null;
	tasks: TaskResponse[];
};

export function isTerminalTaskStatus(
	status: TaskStatus | null | undefined,
): boolean {
	return (
		status === "succeeded" ||
		status === "failed" ||
		status === "partially_succeeded" ||
		status === "cancelled"
	);
}

export async function fetchTasks(
	options: FetchTasksOptions = {},
): Promise<TaskListPage> {
	const searchParams = new URLSearchParams();

	if (options.kind) {
		searchParams.set("kind", options.kind);
	}
	if (options.status) {
		searchParams.set("status", options.status);
	}
	if (typeof options.submittedBy === "number") {
		searchParams.set("submitted_by", String(options.submittedBy));
	}

	searchParams.set("limit", String(options.limit ?? 20));
	searchParams.set("sort", options.sort ?? "created_at.desc,id.desc");

	if (options.cursor?.trim()) {
		searchParams.set("cursor", options.cursor.trim());
	}

	const response = await fetch(`/_hubuum-bff/hubuum/api/v1/tasks?${searchParams.toString()}`, {
		credentials: "include",
	});

	const payload =
		response.status === 204 ? [] : await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(getApiErrorMessage(payload, "Failed to load tasks."));
	}

	return {
		tasks: expectArrayPayload<TaskResponse>(payload, "tasks"),
		nextCursor: response.headers.get("x-next-cursor"),
	};
}

export async function createImportTask(
	payload: ImportRequest,
	idempotencyKey?: string,
): Promise<TaskResponse> {
	const headers = new Headers();

	if (idempotencyKey?.trim()) {
		headers.set("Idempotency-Key", idempotencyKey.trim());
	}

	const response = await postApiV1Imports(payload, {
		credentials: "include",
		headers,
	});

	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to submit import."),
		);
	}

	return response.data;
}

export async function fetchTask(taskId: number): Promise<TaskResponse> {
	const response = await getApiV1TasksByTaskId(taskId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load task state."),
		);
	}

	return response.data;
}

export async function fetchTaskEvents(
	taskId: number,
): Promise<TaskEventResponse[]> {
	const response = await getApiV1TasksByTaskIdEvents(taskId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load task events."),
		);
	}

	return response.data;
}

export async function fetchImportProjection(
	taskId: number,
): Promise<TaskResponse> {
	const response = await getApiV1ImportsByTaskId(taskId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load import task."),
		);
	}

	return response.data;
}

export async function fetchImportResults(
	taskId: number,
): Promise<ImportTaskResultResponse[]> {
	const response = await getApiV1ImportsByTaskIdResults(taskId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load import results."),
		);
	}

	return response.data;
}
