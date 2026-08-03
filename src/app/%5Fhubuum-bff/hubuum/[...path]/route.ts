import { NextRequest, NextResponse } from "next/server";

import { buildBackendUrl, getSafeBackendPathForLogs } from "@/lib/api/backend";
import { copyPaginationHeaders } from "@/lib/api/proxy-pagination-headers";
import { copySafeUpstreamResponseHeaders } from "@/lib/api/proxy-response-headers";
import {
	clearSessionCookie,
	destroySession,
	getSessionFromRequest,
} from "@/lib/auth/session";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	emitOperationalEvent,
	operationalErrorFields,
	operationalLevelForStatus,
} from "@/lib/operational-events";

type RouteContext = {
	params: Promise<{
		path: string[];
	}>;
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

function toUpstreamPath(
	pathParts: string[],
	preserveTrailingSlash: boolean,
): string | null {
	if (!pathParts.length) {
		return null;
	}

	const joinedBase = pathParts.join("/");
	const joined =
		preserveTrailingSlash && !joinedBase.endsWith("/")
			? `${joinedBase}/`
			: joinedBase;
	if (!joined.startsWith("api/")) {
		return null;
	}

	return `/${joined}`;
}

function headerContentLength(headers: Headers): number | undefined {
	const raw = headers.get("content-length");
	if (!raw || !/^\d+$/.test(raw)) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function proxyToBackend(request: NextRequest, context: RouteContext) {
	const method = request.method.toUpperCase();
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	const sourcePath = getSafeBackendPathForLogs(request.nextUrl.pathname);

	if (!ALLOWED_METHODS.has(method)) {
		emitOperationalEvent("warn", "bff.proxy.rejected", {
			correlation_id: correlationId,
			method,
			reason: "method_not_allowed",
			source_path: sourcePath,
			status: 405,
		});
		return NextResponse.json(
			{ error: "MethodNotAllowed", message: `${method} is not supported.` },
			{
				status: 405,
				headers: {
					[CORRELATION_ID_HEADER]: correlationId,
				},
			},
		);
	}

	const resolvedParams = await context.params;
	const preserveTrailingSlash =
		request.nextUrl.pathname.length > 1 &&
		request.nextUrl.pathname.endsWith("/");
	const path = toUpstreamPath(resolvedParams.path, preserveTrailingSlash);
	if (!path) {
		emitOperationalEvent("warn", "bff.proxy.rejected", {
			correlation_id: correlationId,
			method,
			reason: "invalid_upstream_path",
			source_path: sourcePath,
			status: 400,
		});
		return NextResponse.json(
			{ error: "BadRequest", message: "Path must begin with api/." },
			{
				status: 400,
				headers: {
					[CORRELATION_ID_HEADER]: correlationId,
				},
			},
		);
	}

	const session = await getSessionFromRequest(request);
	if (!session) {
		emitOperationalEvent("warn", "bff.proxy.unauthenticated", {
			correlation_id: correlationId,
			method,
			source_path: sourcePath,
			status: 401,
		});
		return NextResponse.json(
			{ error: "Unauthorized", message: "Sign in required." },
			{
				status: 401,
				headers: {
					[CORRELATION_ID_HEADER]: correlationId,
				},
			},
		);
	}

	const upstreamHeaders = new Headers();
	const incomingContentType = request.headers.get("content-type");
	const incomingAccept = request.headers.get("accept");
	const restoreCapability = request.headers.get("x-hubuum-restore-capability");

	if (incomingContentType) {
		upstreamHeaders.set("content-type", incomingContentType);
	}

	if (incomingAccept) {
		upstreamHeaders.set("accept", incomingAccept);
	}

	if (restoreCapability) {
		upstreamHeaders.set("x-hubuum-restore-capability", restoreCapability);
	}

	upstreamHeaders.set("authorization", `Bearer ${session.token}`);
	upstreamHeaders.set(CORRELATION_ID_HEADER, correlationId);

	const bodyAllowed = method !== "GET" && method !== "HEAD";
	const body = bodyAllowed ? await request.text() : undefined;

	const targetUrl = new URL(buildBackendUrl(path));
	targetUrl.search = request.nextUrl.search;
	const safePath = getSafeBackendPathForLogs(
		`${path}${request.nextUrl.search}`,
	);
	const startedAt = Date.now();

	let upstreamResponse: Response;
	try {
		upstreamResponse = await fetch(targetUrl, {
			method,
			headers: upstreamHeaders,
			body: bodyAllowed ? body : undefined,
			cache: "no-store",
		});
		emitOperationalEvent(
			operationalLevelForStatus(upstreamResponse.status),
			"bff.proxy.completed",
			{
				correlation_id: correlationId,
				duration_ms: Date.now() - startedAt,
				method,
				path: safePath,
				request_bytes: headerContentLength(request.headers),
				response_bytes: headerContentLength(upstreamResponse.headers),
				source_path: sourcePath,
				status: upstreamResponse.status,
			},
		);
	} catch (error) {
		emitOperationalEvent("error", "bff.proxy.failed", {
			correlation_id: correlationId,
			duration_ms: Date.now() - startedAt,
			method,
			path: safePath,
			request_bytes: headerContentLength(request.headers),
			source_path: sourcePath,
			...operationalErrorFields(error),
		});
		return NextResponse.json(
			{
				error: "UpstreamUnavailable",
				message: "Failed to reach backend service.",
			},
			{
				status: 502,
				headers: {
					[CORRELATION_ID_HEADER]: correlationId,
				},
			},
		);
	}

	const status = upstreamResponse.status;
	const hasNoBody = status === 204 || status === 205 || status === 304;
	const responseBody = hasNoBody ? null : await upstreamResponse.text();
	const response = new NextResponse(responseBody, {
		status,
	});

	const contentType = upstreamResponse.headers.get("content-type");
	if (!hasNoBody && contentType) {
		response.headers.set("content-type", contentType);
	}
	copyPaginationHeaders(upstreamResponse.headers, response.headers);
	copySafeUpstreamResponseHeaders(upstreamResponse.headers, response.headers);
	response.headers.set(CORRELATION_ID_HEADER, correlationId);

	if (upstreamResponse.status === 401) {
		await destroySession(session.sid);
		clearSessionCookie(response, request);
	}

	return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
	return proxyToBackend(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
	return proxyToBackend(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
	return proxyToBackend(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
	return proxyToBackend(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
	return proxyToBackend(request, context);
}
