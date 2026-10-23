import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
	clearSessionCookie,
	invalidateRejectedSession,
	type ActiveSession,
} from "@/lib/auth/session";
import { CORRELATION_ID_HEADER } from "@/lib/correlation";

export async function handleUnauthorizedResponse(
	response: NextResponse,
	request: NextRequest,
	session: ActiveSession,
): Promise<NextResponse> {
	if (await invalidateRejectedSession(session)) {
		clearSessionCookie(response, request);
		return response;
	}
	void response.body?.cancel().catch(() => {
		// Cleanup must not hide the retry response if the upstream disconnected.
	});
	// Keep the browser's global 401 handler from signing out a rotated session.
	// Mutations are not replayed: the caller must explicitly retry the operation.
	const headers = new Headers({ "Cache-Control": "private, no-store" });
	const correlationId = response.headers.get(CORRELATION_ID_HEADER);
	if (correlationId) headers.set(CORRELATION_ID_HEADER, correlationId);
	return NextResponse.json(
		{
			error: "session_rotated",
			message:
				"Your session refreshed while this request was running. Try again.",
		},
		{ status: 409, headers },
	);
}
