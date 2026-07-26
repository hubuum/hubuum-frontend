import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";
import { getApiErrorMessage } from "@/lib/api/errors";
import type {
	ExportLimits,
	ExportMissingDataPolicy,
	ExportTemplateRunRequest,
	TaskStatus,
} from "@/lib/api/generated/models";
import { parseReportMaxAge } from "@/lib/report-max-age";
import {
	getTemplateReportRunStore,
	type TemplateReportRunStore,
} from "@/lib/template-report-run-store";

const REPORT_POLL_INTERVAL_MS = 50;
const REPORT_WAIT_TIMEOUT_MS = 30_000;
const REPORT_LOCK_TTL_MS = REPORT_WAIT_TIMEOUT_MS + 5_000;
const MAX_BOOKMARK_QUERY_LENGTH = 16_384;
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
	"succeeded",
	"failed",
	"partially_succeeded",
	"cancelled",
]);

type ReportTaskState = {
	createdAt: string | null;
	finishedAt: string | null;
	id: number;
	outputAvailable: boolean | null;
	outputExpired: boolean | null;
	status: TaskStatus;
	summary: string | null;
};

type BackendFetch = typeof backendFetchRaw;

type ReportDependencies = {
	backendFetch?: BackendFetch;
	now?: () => number;
	runStore?: TemplateReportRunStore;
	sleep?: (milliseconds: number) => Promise<void>;
	timeoutMs?: number;
};

type ReportRuntime = {
	backendFetch: BackendFetch;
	deadline: number;
	now: () => number;
	sleep: (milliseconds: number) => Promise<void>;
};

export type BookmarkableReportFreshness = {
	maxAgeMilliseconds: number | null;
};

export class RawReportError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "RawReportError";
	}
}

function parseOptionalInteger(
	searchParams: URLSearchParams,
	name: string,
	minimum: number,
): number | null {
	const raw = searchParams.get(name);
	if (raw === null) {
		return null;
	}
	if (!/^\d+$/.test(raw)) {
		throw new RawReportError(
			`${name} must be a whole number of at least ${minimum}.`,
			400,
		);
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(parsed) || parsed < minimum) {
		throw new RawReportError(
			`${name} must be a whole number of at least ${minimum}.`,
			400,
		);
	}
	return parsed;
}

export function parseBookmarkableReportRequest(
	searchParams: URLSearchParams,
): ExportTemplateRunRequest {
	const request: ExportTemplateRunRequest = {};
	const query = searchParams.get("query");
	if (query !== null) {
		if (query.length > MAX_BOOKMARK_QUERY_LENGTH) {
			throw new RawReportError(
				`query must be ${MAX_BOOKMARK_QUERY_LENGTH} characters or fewer.`,
				400,
			);
		}
		request.query = query || null;
	}

	const objectId = parseOptionalInteger(searchParams, "object_id", 1);
	if (objectId !== null) {
		request.object_id = objectId;
	}

	const missingDataPolicy = searchParams.get("missing_data_policy");
	if (missingDataPolicy !== null) {
		if (
			missingDataPolicy !== "strict" &&
			missingDataPolicy !== "null" &&
			missingDataPolicy !== "omit"
		) {
			throw new RawReportError(
				"missing_data_policy must be strict, null, or omit.",
				400,
			);
		}
		request.missing_data_policy = missingDataPolicy as ExportMissingDataPolicy;
	}

	const maxItems = parseOptionalInteger(searchParams, "max_items", 0);
	const maxOutputBytes = parseOptionalInteger(
		searchParams,
		"max_output_bytes",
		0,
	);
	if (maxItems !== null || maxOutputBytes !== null) {
		const limits: ExportLimits = {};
		if (maxItems !== null) {
			limits.max_items = maxItems;
		}
		if (maxOutputBytes !== null) {
			limits.max_output_bytes = maxOutputBytes;
		}
		request.limits = limits;
	}

	return request;
}

export function parseBookmarkableReportFreshness(
	searchParams: URLSearchParams,
): BookmarkableReportFreshness {
	const raw = searchParams.get("max_age");
	const parsed = parseReportMaxAge(raw);
	if (!parsed.ok) {
		throw new RawReportError(
			parsed.message.replace("Maximum age", "max_age"),
			400,
		);
	}

	return { maxAgeMilliseconds: parsed.maxAgeMilliseconds };
}

function readTaskState(value: unknown): ReportTaskState | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as {
		created_at?: unknown;
		details?: unknown;
		finished_at?: unknown;
		id?: unknown;
		status?: unknown;
		summary?: unknown;
	};
	if (
		typeof candidate.id !== "number" ||
		!Number.isSafeInteger(candidate.id) ||
		candidate.id < 1 ||
		typeof candidate.status !== "string" ||
		![
			"queued",
			"validating",
			"running",
			"succeeded",
			"failed",
			"partially_succeeded",
			"cancelled",
		].includes(candidate.status)
	) {
		return null;
	}

	const details =
		candidate.details && typeof candidate.details === "object"
			? (candidate.details as { export?: unknown }).export
			: null;
	const exportDetails =
		details && typeof details === "object"
			? (details as {
					output_available?: unknown;
					output_expired?: unknown;
				})
			: null;

	return {
		createdAt:
			typeof candidate.created_at === "string"
				? candidate.created_at
				: null,
		finishedAt:
			typeof candidate.finished_at === "string"
				? candidate.finished_at
				: null,
		id: candidate.id,
		outputAvailable:
			typeof exportDetails?.output_available === "boolean"
				? exportDetails.output_available
				: null,
		outputExpired:
			typeof exportDetails?.output_expired === "boolean"
				? exportDetails.output_expired
				: null,
		status: candidate.status as TaskStatus,
		summary: typeof candidate.summary === "string" ? candidate.summary : null,
	};
}

async function responseError(
	response: Response,
	fallback: string,
): Promise<RawReportError> {
	const contentType = response.headers.get("content-type") ?? "";
	const payload = contentType.includes("application/json")
		? await response.json().catch(() => null)
		: await response.text().catch(() => "");
	const message =
		typeof payload === "string" && payload.trim()
			? payload
			: getApiErrorMessage(payload, fallback);
	return new RawReportError(message, response.status);
}

async function readTaskResponse(
	response: Response,
	expectedStatus: number,
	fallback: string,
): Promise<ReportTaskState> {
	if (response.status !== expectedStatus) {
		throw await responseError(response, fallback);
	}

	const payload = await response.json().catch(() => null);
	const task = readTaskState(payload);
	if (!task) {
		throw new RawReportError(
			"The backend returned an invalid export task response.",
			502,
		);
	}
	return task;
}

function rawOutputResponse(upstream: Response): Response {
	const contentType =
		upstream.headers.get("content-type") ?? "application/octet-stream";
	const headers = new Headers({
		"Cache-Control": "private, no-store",
		"Content-Disposition": "inline",
		"Content-Type": contentType,
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
	});
	const warningCount = upstream.headers.get("x-hubuum-export-warnings");
	if (warningCount) {
		headers.set("X-Hubuum-Export-Warnings", warningCount);
	}
	const truncated = upstream.headers.get("x-hubuum-export-truncated");
	if (truncated) {
		headers.set("X-Hubuum-Export-Truncated", truncated);
	}

	if (contentType.split(";")[0]?.trim().toLowerCase() === "text/html") {
		headers.set(
			"Content-Security-Policy",
			"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
		);
	}

	return new Response(upstream.body, {
		status: 200,
		headers,
	});
}

function createRuntime(dependencies: ReportDependencies): ReportRuntime {
	const now = dependencies.now ?? Date.now;
	return {
		backendFetch: dependencies.backendFetch ?? backendFetchRaw,
		deadline: now() + (dependencies.timeoutMs ?? REPORT_WAIT_TIMEOUT_MS),
		now,
		sleep:
			dependencies.sleep ??
			((milliseconds: number) =>
				new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
	};
}

function isActiveTask(task: ReportTaskState): boolean {
	return !TERMINAL_TASK_STATUSES.has(task.status);
}

function isSuccessfulTask(task: ReportTaskState): boolean {
	return (
		task.status === "succeeded" ||
		task.status === "partially_succeeded"
	);
}

function taskIsFresh(
	task: ReportTaskState,
	maxAgeMilliseconds: number | null,
	now: number,
): boolean {
	if (maxAgeMilliseconds === null) {
		return true;
	}
	if (maxAgeMilliseconds === 0) {
		return false;
	}

	const timestamp = Date.parse(task.finishedAt ?? task.createdAt ?? "");
	if (Number.isNaN(timestamp)) {
		return false;
	}
	return Math.max(0, now - timestamp) <= maxAgeMilliseconds;
}

async function fetchRawOutput({
	correlationId,
	runtime,
	taskId,
	token,
}: {
	correlationId: string;
	runtime: ReportRuntime;
	taskId: number;
	token: string;
}): Promise<Response> {
	const output = await runtime.backendFetch(
		`/api/v1/exports/${taskId}/output`,
		{
			correlationId,
			headers: {
				Accept: "*/*",
			},
			method: "GET",
			token,
		},
	);
	if (!output.ok) {
		throw await responseError(output, "Failed to load export output.");
	}
	return rawOutputResponse(output);
}

async function fetchTask(
	taskId: number,
	correlationId: string,
	token: string,
	runtime: ReportRuntime,
): Promise<ReportTaskState | null> {
	const response = await runtime.backendFetch(`/api/v1/exports/${taskId}`, {
		correlationId,
		method: "GET",
		token,
	});
	if (response.status === 404 || response.status === 410) {
		return null;
	}
	return readTaskResponse(response, 200, "Failed to read report progress.");
}

async function waitForTask(
	task: ReportTaskState,
	correlationId: string,
	token: string,
	runtime: ReportRuntime,
): Promise<ReportTaskState> {
	let current = task;
	while (isActiveTask(current)) {
		const remaining = runtime.deadline - runtime.now();
		if (remaining <= 0) {
			throw new RawReportError(
				"The report is still running. Reload the page to try again.",
				504,
			);
		}
		await runtime.sleep(Math.min(REPORT_POLL_INTERVAL_MS, remaining));
		const next = await fetchTask(
			current.id,
			correlationId,
			token,
			runtime,
		);
		if (!next) {
			throw new RawReportError("The report task is no longer available.", 404);
		}
		current = next;
	}
	return current;
}

async function submitTemplateReport(
	templateId: number,
	request: ExportTemplateRunRequest,
	correlationId: string,
	token: string,
	runtime: ReportRuntime,
): Promise<ReportTaskState> {
	const submission = await runtime.backendFetch(
		`/api/v1/export-templates/${templateId}/exports`,
		{
			body: JSON.stringify(request),
			correlationId,
			headers: {
				"Content-Type": "application/json",
			},
			method: "POST",
			token,
		},
	);
	return readTaskResponse(
		submission,
		202,
		"Failed to generate the report.",
	);
}

async function renderTask(
	task: ReportTaskState,
	correlationId: string,
	token: string,
	runtime: ReportRuntime,
): Promise<Response> {
	const completed = await waitForTask(task, correlationId, token, runtime);
	if (!isSuccessfulTask(completed)) {
		throw new RawReportError(
			completed.summary?.trim() || `The report ${completed.status}.`,
			502,
		);
	}
	return fetchRawOutput({
		correlationId,
		runtime,
		taskId: completed.id,
		token,
	});
}

async function templateRevision(
	templateId: number,
	correlationId: string,
	token: string,
	runtime: ReportRuntime,
): Promise<string> {
	const response = await runtime.backendFetch(
		`/api/v1/export-templates/${templateId}`,
		{
			correlationId,
			method: "GET",
			token,
		},
	);
	if (response.status !== 200) {
		throw await responseError(response, "Failed to load export template.");
	}

	const payload = (await response.json().catch(() => null)) as {
		kind?: unknown;
		updated_at?: unknown;
	} | null;
	if (
		payload?.kind !== "export" ||
		typeof payload.updated_at !== "string" ||
		!payload.updated_at
	) {
		throw new RawReportError(
			"The backend returned an invalid executable export template.",
			502,
		);
	}
	return payload.updated_at;
}

function canonicalRequest(request: ExportTemplateRunRequest): string {
	return JSON.stringify({
		limits: {
			max_items: request.limits?.max_items ?? null,
			max_output_bytes: request.limits?.max_output_bytes ?? null,
		},
		missing_data_policy: request.missing_data_policy ?? null,
		object_id: request.object_id ?? null,
		query: request.query ?? null,
	});
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

async function reportCacheKey({
	request,
	revision,
	sessionId,
	templateId,
}: {
	request: ExportTemplateRunRequest;
	revision: string;
	sessionId: string;
	templateId: number;
}): Promise<string> {
	const fingerprint = await sha256(`${revision}\n${canonicalRequest(request)}`);
	return `${sessionId}:${templateId}:${fingerprint}`;
}

async function tryCachedReport({
	cacheKey,
	correlationId,
	freshness,
	runStore,
	runtime,
	taskId,
	token,
}: {
	cacheKey: string;
	correlationId: string;
	freshness: BookmarkableReportFreshness;
	runStore: TemplateReportRunStore;
	runtime: ReportRuntime;
	taskId: number;
	token: string;
}): Promise<Response | null> {
	let task = await fetchTask(taskId, correlationId, token, runtime);
	if (
		task?.status === "queued" ||
		task?.status === "validating" ||
		task?.status === "running"
	) {
		task = await waitForTask(task, correlationId, token, runtime);
	}

	if (
		!task ||
		!isSuccessfulTask(task) ||
		task.outputAvailable === false ||
		task.outputExpired === true ||
		!taskIsFresh(task, freshness.maxAgeMilliseconds, runtime.now())
	) {
		await runStore.deleteTaskId(cacheKey, taskId);
		return null;
	}

	try {
		return await fetchRawOutput({
			correlationId,
			runtime,
			taskId,
			token,
		});
	} catch (error) {
		if (
			error instanceof RawReportError &&
			(error.status === 404 || error.status === 410)
		) {
			await runStore.deleteTaskId(cacheKey, taskId);
			return null;
		}
		throw error;
	}
}

export async function getStoredRawReport({
	correlationId,
	taskId,
	token,
	dependencies = {},
}: {
	correlationId: string;
	taskId: number;
	token: string;
	dependencies?: ReportDependencies;
}): Promise<Response> {
	return fetchRawOutput({
		correlationId,
		runtime: createRuntime(dependencies),
		taskId,
		token,
	});
}

export async function renderFreshTemplateReport({
	correlationId,
	request,
	templateId,
	token,
	dependencies = {},
}: {
	correlationId: string;
	request: ExportTemplateRunRequest;
	templateId: number;
	token: string;
	dependencies?: ReportDependencies;
}): Promise<Response> {
	const runtime = createRuntime(dependencies);
	const task = await submitTemplateReport(
		templateId,
		request,
		correlationId,
		token,
		runtime,
	);
	return renderTask(task, correlationId, token, runtime);
}

export async function renderBookmarkableTemplateReport({
	correlationId,
	freshness,
	request,
	sessionId,
	templateId,
	token,
	dependencies = {},
}: {
	correlationId: string;
	freshness: BookmarkableReportFreshness;
	request: ExportTemplateRunRequest;
	sessionId: string;
	templateId: number;
	token: string;
	dependencies?: ReportDependencies;
}): Promise<Response> {
	const runtime = createRuntime(dependencies);
	const runStore = dependencies.runStore ?? getTemplateReportRunStore();
	const revision = await templateRevision(
		templateId,
		correlationId,
		token,
		runtime,
	);
	const cacheKey = await reportCacheKey({
		request,
		revision,
		sessionId,
		templateId,
	});
	const initialTaskId = await runStore.getTaskId(cacheKey);

	if (initialTaskId !== null && freshness.maxAgeMilliseconds !== 0) {
		const cached = await tryCachedReport({
			cacheKey,
			correlationId,
			freshness,
			runStore,
			runtime,
			taskId: initialTaskId,
			token,
		});
		if (cached) {
			return cached;
		}
	}

	const owner = crypto.randomUUID();
	while (runtime.now() < runtime.deadline) {
		const acquired = await runStore.tryAcquireLock(
			cacheKey,
			owner,
			REPORT_LOCK_TTL_MS,
		);
		if (acquired) {
			try {
				const currentTaskId = await runStore.getTaskId(cacheKey);
				if (currentTaskId !== null && currentTaskId !== initialTaskId) {
					const joined = await tryCachedReport({
						cacheKey,
						correlationId,
						freshness: { maxAgeMilliseconds: null },
						runStore,
						runtime,
						taskId: currentTaskId,
						token,
					});
					if (joined) {
						return joined;
					}
				}

				const task = await submitTemplateReport(
					templateId,
					request,
					correlationId,
					token,
					runtime,
				);
				await runStore.setTaskId(cacheKey, task.id);
				return await renderTask(task, correlationId, token, runtime);
			} finally {
				await runStore.releaseLock(cacheKey, owner);
			}
		}

		const currentTaskId = await runStore.getTaskId(cacheKey);
		if (currentTaskId !== null && currentTaskId !== initialTaskId) {
			const joined = await tryCachedReport({
				cacheKey,
				correlationId,
				freshness: { maxAgeMilliseconds: null },
				runStore,
				runtime,
				taskId: currentTaskId,
				token,
			});
			if (joined) {
				return joined;
			}
		}
		await runtime.sleep(REPORT_POLL_INTERVAL_MS);
	}

	throw new RawReportError(
		"The report is still being generated. Reload the page to try again.",
		504,
	);
}
