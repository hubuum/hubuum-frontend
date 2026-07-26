import "server-only";

import { NextRequest, NextResponse } from "next/server";

import {
	clearSessionCookie,
	destroySession,
	getSessionFromRequest,
	type ActiveSession,
} from "@/lib/auth/session";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { normalizeReturnPath } from "@/lib/return-path";
import { RawReportError } from "@/lib/server-template-report";

export type RawReportRequestContext = {
	correlationId: string;
	session: ActiveSession;
};

function loginRedirect(request: NextRequest): NextResponse {
	const returnPath = normalizeReturnPath(
		`${request.nextUrl.pathname}${request.nextUrl.search}`,
	);
	const loginUrl = new URL("/login", request.url);
	loginUrl.searchParams.set("next", returnPath);
	return NextResponse.redirect(loginUrl);
}

export async function requireRawReportSession(
	request: NextRequest,
): Promise<RawReportRequestContext | NextResponse> {
	const session = await getSessionFromRequest(request);
	if (!session) {
		return loginRedirect(request);
	}

	return {
		correlationId:
			normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
			generateCorrelationId(),
		session,
	};
}

export async function rawReportErrorResponse(
	error: unknown,
	request: NextRequest,
	session: ActiveSession,
): Promise<Response> {
	const status = error instanceof RawReportError ? error.status : 502;
	if (status === 401) {
		await destroySession(session.sid);
		const response = loginRedirect(request);
		clearSessionCookie(response, request);
		return response;
	}

	const message =
		error instanceof RawReportError
			? error.message
			: "The report service is temporarily unavailable.";
	return new Response(message, {
		status,
		headers: {
			"Cache-Control": "private, no-store",
			"Content-Type": "text/plain;charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

export function rawReportHeadResponse(): Response {
	return new Response(null, {
		status: 405,
		headers: {
			Allow: "GET",
			"Cache-Control": "private, no-store",
		},
	});
}
