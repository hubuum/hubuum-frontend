import { collectAllCursorPages } from "@/lib/api/cursor-pages";
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
	TaskResponse,
	TaskStatus,
} from "@/lib/api/generated/models";
import { acquireOperationIdempotencyKey } from "@/lib/operation-idempotency";

export type {
	ImportRequest,
	ImportTaskResultResponse as ImportResult,
	TaskEventResponse as TaskEvent,
	TaskKind,
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

export type TaskActivitySummary = {
	activeTasks: number;
	failedTasks: number;
	oldestActiveAt: string | null;
	oldestQueuedAt: string | null;
	partiallySucceededTasks: number;
	queuedTasks: number;
	runningTasks: number;
	totalLoaded: number;
	validatingTasks: number;
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

export type TaskStatusTone = "neutral" | "success" | "danger" | "accent";

export function getTaskStatusTone(
	status: TaskStatus | null | undefined,
): TaskStatusTone {
	if (status === "succeeded") {
		return "success";
	}
	if (status === "failed" || status === "cancelled") {
		return "danger";
	}
	if (status === "partially_succeeded") {
		return "accent";
	}
	return "neutral";
}

export function getTaskProgressPercent(
	task: Pick<TaskResponse, "progress" | "status"> | null | undefined,
): number {
	if (!task) {
		return 0;
	}
	if (isTerminalTaskStatus(task.status)) {
		return 100;
	}
	if (task.progress.total_items <= 0) {
		return 0;
	}

	return Math.min(
		100,
		Math.round(
			(task.progress.processed_items / task.progress.total_items) * 100,
		),
	);
}

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1000) {
		return `${Math.round(milliseconds)} ms`;
	}
	if (milliseconds < 10_000) {
		return `${(milliseconds / 1000).toFixed(1).replace(/\.0$/, "")} s`;
	}
	if (milliseconds < 60_000) {
		return `${Math.floor(milliseconds / 1000)} s`;
	}

	const totalSeconds = Math.floor(milliseconds / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const totalHours = Math.floor(totalMinutes / 60);
	const hours = totalHours % 24;
	const days = Math.floor(totalHours / 24);

	if (days > 0) {
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (totalHours > 0) {
		return `${totalHours}h ${minutes}m ${seconds}s`;
	}
	return `${totalMinutes}m ${seconds}s`;
}

export function formatTaskElapsedTime(
	task:
		| Pick<TaskResponse, "finished_at" | "started_at" | "status">
		| null
		| undefined,
	now: number,
): string {
	if (!task?.started_at) {
		return "Not started";
	}

	const startedAt = Date.parse(task.started_at);
	const finishedAt = task.finished_at
		? Date.parse(task.finished_at)
		: isTerminalTaskStatus(task.status)
			? Number.NaN
			: now;
	const runtime = finishedAt - startedAt;

	if (
		Number.isNaN(startedAt) ||
		Number.isNaN(finishedAt) ||
		runtime < 0
	) {
		return "n/a";
	}

	return formatDuration(runtime);
}

function earlierTimestamp(
	current: string | null,
	candidate: string | null | undefined,
): string | null {
	if (!candidate) {
		return current;
	}
	if (!current) {
		return candidate;
	}

	const currentTime = Date.parse(current);
	const candidateTime = Date.parse(candidate);

	if (Number.isNaN(currentTime) || Number.isNaN(candidateTime)) {
		return candidate < current ? candidate : current;
	}

	return candidateTime < currentTime ? candidate : current;
}

export function summarizeTaskActivity(
	tasks: readonly Pick<TaskResponse, "created_at" | "started_at" | "status">[],
): TaskActivitySummary {
	const summary: TaskActivitySummary = {
		activeTasks: 0,
		failedTasks: 0,
		oldestActiveAt: null,
		oldestQueuedAt: null,
		partiallySucceededTasks: 0,
		queuedTasks: 0,
		runningTasks: 0,
		totalLoaded: tasks.length,
		validatingTasks: 0,
	};

	for (const task of tasks) {
		if (!isTerminalTaskStatus(task.status)) {
			summary.activeTasks += 1;
			summary.oldestActiveAt = earlierTimestamp(
				summary.oldestActiveAt,
				task.started_at ?? task.created_at,
			);
		}

		if (task.status === "queued") {
			summary.queuedTasks += 1;
			summary.oldestQueuedAt = earlierTimestamp(
				summary.oldestQueuedAt,
				task.created_at,
			);
		}
		if (task.status === "validating") {
			summary.validatingTasks += 1;
		}
		if (task.status === "running") {
			summary.runningTasks += 1;
		}
		if (task.status === "failed") {
			summary.failedTasks += 1;
		}
		if (task.status === "partially_succeeded") {
			summary.partiallySucceededTasks += 1;
		}
	}

	return summary;
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
	searchParams.set("include_total", "false");

	if (options.cursor?.trim()) {
		searchParams.set("cursor", options.cursor.trim());
	}

	const response = await fetch(
		`/_hubuum-bff/hubuum/api/v1/tasks?${searchParams.toString()}`,
		{
			credentials: "include",
		},
	);

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
	const idempotency = await acquireOperationIdempotencyKey(
		"import",
		payload,
		idempotencyKey,
	);
	const response = await postApiV1Imports(payload, {
		credentials: "include",
		headers: { "Idempotency-Key": idempotency.key },
	});

	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to submit import."),
		);
	}

	idempotency.complete();
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
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1TasksByTaskIdEvents(
			taskId,
			{ cursor, include_total: false, limit: 250 },
			{ credentials: "include" },
		);

		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load task events."),
			);
		}

		return {
			items: response.data,
			nextCursor: response.headers.get("x-next-cursor"),
		};
	});
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
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1ImportsByTaskIdResults(
			taskId,
			{ cursor, include_total: false, limit: 250 },
			{ credentials: "include" },
		);

		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load import results."),
			);
		}

		return {
			items: response.data,
			nextCursor: response.headers.get("x-next-cursor"),
		};
	});
}
