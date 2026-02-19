import "server-only";

import { getServerEnv } from "@/lib/env";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";

type BackendRequestInit = RequestInit & {
  correlationId?: string;
  token?: string;
};

function redactSensitivePath(path: string): string {
  return path
    .replace(/(\/auth\/logout\/token\/)[^/]+/gi, "$1[redacted]")
    .replace(/([?&](?:password|token)=)[^&]+/gi, "$1[redacted]");
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
  }
}

export function buildBackendUrl(path: string): string {
  const env = getServerEnv();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, env.BACKEND_BASE_URL).toString();
}

export function getSafeBackendPathForLogs(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return redactSensitivePath(withSlash);
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

export async function backendFetchRaw(path: string, init: BackendRequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  const safePath = getSafeBackendPathForLogs(path);
  const startedAt = Date.now();

  headers.set("Accept", "application/json");
  const normalizedCorrelationId = normalizeCorrelationId(init.correlationId);
  if (normalizedCorrelationId) {
    headers.set(CORRELATION_ID_HEADER, normalizedCorrelationId);
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  const correlationId = headers.get(CORRELATION_ID_HEADER) ?? "-";
  console.info(`[hubuum-backend][cid=${correlationId}] -> ${method} ${safePath}`);

  try {
    const response = await fetch(buildBackendUrl(path), {
      ...init,
      headers,
      cache: "no-store"
    });

    console.info(
      `[hubuum-backend][cid=${correlationId}] <- ${method} ${safePath} ${response.status} ${Date.now() - startedAt}ms`
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[hubuum-backend][cid=${correlationId}] !! ${method} ${safePath} ${Date.now() - startedAt}ms ${message}`
    );
    throw error;
  }
}

export async function backendFetchJson<T>(path: string, init: BackendRequestInit = {}): Promise<T> {
  const response = await backendFetchRaw(path, init);
  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new BackendError(
      `Backend request failed: ${init.method ?? "GET"} ${path}`,
      response.status,
      payload
    );
  }

  return payload as T;
}
