import { NextRequest, NextResponse } from "next/server";

import {
	clearSessionCookie,
	destroySession,
	getSessionFromRequest,
} from "@/lib/auth/session";
import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { parseReportResultStatusRequest } from "@/lib/report-result-status";
import {
	getBookmarkableTemplateReportStatus,
	RawReportError,
} from "@/lib/server-template-report";

function jsonResponse(
	body: unknown,
	status: number,
	correlationId: string,
): NextResponse {
	return NextResponse.json(body, {
		status,
		headers: {
			"Cache-Control": "private, no-store",
			[CORRELATION_ID_HEADER]: correlationId,
		},
	});
}

export async function POST(request: NextRequest) {
	const originRejection = rejectCrossOriginBffMutation(request);
	if (originRejection) return originRejection;

	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	const session = await getSessionFromRequest(request);
	if (!session) {
		return jsonResponse(
			{ message: "Authentication required." },
			401,
			correlationId,
		);
	}

	const payload = await request.json().catch(() => null);
	const templates = parseReportResultStatusRequest(payload);
	if (!templates) {
		return jsonResponse(
			{ message: "Invalid report result status request." },
			400,
			correlationId,
		);
	}

	try {
		const results = await Promise.all(
			templates.map(async ({ revision, templateId }) => ({
				...(await getBookmarkableTemplateReportStatus({
					correlationId,
					revision,
					sessionId: session.sid,
					templateId,
					token: session.token,
				})),
				templateId,
			})),
		);
		return jsonResponse({ results }, 200, correlationId);
	} catch (error) {
		const unauthorized =
			error instanceof RawReportError && error.status === 401;
		const response = jsonResponse(
			{
				message: unauthorized
					? "Authentication required."
					: "Report result status is temporarily unavailable.",
			},
			unauthorized ? 401 : 502,
			correlationId,
		);
		if (unauthorized) {
			await destroySession(session.sid);
			clearSessionCookie(response, request);
		}
		return response;
	}
}
