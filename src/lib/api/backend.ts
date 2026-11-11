import "server-only";

import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	assertBackendTarget,
	type BackendCredential,
	type BackendTarget,
	getBackendTarget,
} from "@/lib/backend-target";
import { getServerEnv } from "@/lib/env";
import {
	emitOperationalEvent,
	operationalErrorFields,
	operationalLevelForStatus,
	sanitizeOperationalPath,
} from "@/lib/operational-events";

type BackendRequestInit = RequestInit & {
	correlationId?: string;
	token?: BackendCredential;
	target?: BackendTarget;
};

export class BackendError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly payload: unknown,
	) {
		super(message);
	}
}

export async function buildBackendUrl(
	path: string,
	target?: BackendTarget,
): Promise<string> {
	if (target) await assertBackendTarget(target);
	const selected = target ?? (await getBackendTarget());
	if (!selected) throw new Error("Backend setup is required.");
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return new URL(normalizedPath, selected.origin).toString();
}

export function getSafeBackendPathForLogs(path: string): string {
	return sanitizeOperationalPath(path);
}

async function parseResponse(response: Response): Promise<unknown> {
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

function responseContentLength(response: Response): number | undefined {
	const raw = response.headers.get("content-length");
	if (!raw || !/^\d+$/.test(raw)) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export async function backendFetchRaw(
	path: string,
	init: BackendRequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	const credential = init.token;
	const target =
		typeof credential === "object" ? credential.target : init.target;
	if (
		typeof credential === "string" &&
		!target &&
		!getServerEnv().BACKEND_BASE_URL
	)
		throw new Error("A credential must be bound to its backend connection.");
	const method = (init.method ?? "GET").toUpperCase();
	const safePath = getSafeBackendPathForLogs(path);
	const startedAt = Date.now();

	if (!headers.has("Accept")) {
		headers.set("Accept", "application/json");
	}
	const normalizedCorrelationId = normalizeCorrelationId(init.correlationId);
	if (normalizedCorrelationId) {
		headers.set(CORRELATION_ID_HEADER, normalizedCorrelationId);
	}
	if (init.token) {
		headers.set(
			"Authorization",
			`Bearer ${typeof credential === "object" ? credential.token : credential}`,
		);
	}
	const correlationId = headers.get(CORRELATION_ID_HEADER) ?? "-";

	try {
		const response = await fetch(await buildBackendUrl(path, target), {
			...init,
			headers,
			cache: "no-store",
			redirect: "error",
		});
		const duration = Date.now() - startedAt;
		emitOperationalEvent(
			operationalLevelForStatus(response.status),
			"backend.request.completed",
			{
				correlation_id: correlationId,
				duration_ms: duration,
				method,
				path: safePath,
				response_bytes: responseContentLength(response),
				status: response.status,
			},
		);
		return response;
	} catch (error) {
		emitOperationalEvent("error", "backend.request.failed", {
			correlation_id: correlationId,
			duration_ms: Date.now() - startedAt,
			method,
			path: safePath,
			...operationalErrorFields(error),
		});
		throw error;
	}
}

export async function backendFetchJson<T>(
	path: string,
	init: BackendRequestInit = {},
): Promise<T> {
	const response = await backendFetchRaw(path, init);
	const payload = await parseResponse(response);

	if (!response.ok) {
		throw new BackendError(
			`Backend request failed: ${init.method ?? "GET"} ${path}`,
			response.status,
			payload,
		);
	}

	return payload as T;
}
