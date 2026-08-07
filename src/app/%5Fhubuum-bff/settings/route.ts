import { NextRequest, NextResponse } from "next/server";

import { getCurrentPrincipalId } from "@/lib/auth/current-principal";
import { invalidateProtectedLayoutBootstrap } from "@/lib/auth/protected-layout-bootstrap";
import {
	clearSessionCookie,
	destroySession,
	getSessionFromRequest,
	type ActiveSession,
} from "@/lib/auth/session";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	loadUserSettingsSnapshotForPrincipal,
	patchUserSettingsForPrincipal,
	UserSettingsServerError,
} from "@/lib/user-settings-server";
import { UserSettingsLimitError } from "@/lib/user-settings-store";
import { normalizeUserSettingUpdates } from "@/lib/user-settings-types";

async function getRequestIdentity(
	request: NextRequest,
	session: ActiveSession,
) {
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		undefined;

	const principalId = await getCurrentPrincipalId(session.token, correlationId);
	return principalId
		? { principalId, sid: session.sid, token: session.token, correlationId }
		: null;
}

async function unauthenticatedResponse(
	request: NextRequest,
	session: ActiveSession | null,
): Promise<NextResponse> {
	const response = NextResponse.json(
		{ message: "Authentication required." },
		{ status: 401 },
	);
	return invalidateSessionForUnauthorizedResponse(response, request, session);
}

async function invalidateSessionForUnauthorizedResponse(
	response: NextResponse,
	request: NextRequest,
	session: ActiveSession | null,
): Promise<NextResponse> {
	if (response.status !== 401) {
		return response;
	}
	if (session) {
		await destroySession(session.sid);
	}
	clearSessionCookie(response, request);
	return response;
}

export async function GET(request: NextRequest) {
	const session = await getSessionFromRequest(request);
	if (!session) {
		return unauthenticatedResponse(request, null);
	}
	const identity = await getRequestIdentity(request, session);
	if (!identity) {
		return unauthenticatedResponse(request, session);
	}

	try {
		return NextResponse.json(
			await loadUserSettingsSnapshotForPrincipal(identity),
		);
	} catch (error) {
		const status =
			error instanceof UserSettingsServerError && error.status === 401
				? 401
				: 503;
		const response = NextResponse.json(
			{ message: "User settings are temporarily unavailable." },
			{ status },
		);
		return invalidateSessionForUnauthorizedResponse(
			response,
			request,
			session,
		);
	}
}

export async function PATCH(request: NextRequest) {
	const session = await getSessionFromRequest(request);
	if (!session) {
		return unauthenticatedResponse(request, null);
	}
	const identity = await getRequestIdentity(request, session);
	if (!identity) {
		return unauthenticatedResponse(request, session);
	}

	const payload = (await request.json().catch(() => null)) as {
		updates?: unknown;
	} | null;
	const updates = normalizeUserSettingUpdates(payload?.updates);
	if (!updates) {
		return NextResponse.json(
			{ message: "Invalid user settings update." },
			{ status: 400 },
		);
	}

	try {
		const snapshot = await patchUserSettingsForPrincipal(identity, updates);
		invalidateProtectedLayoutBootstrap(identity.sid);
		return NextResponse.json(snapshot);
	} catch (error) {
		const isLimitError = error instanceof UserSettingsLimitError;
		const backendStatus =
			error instanceof UserSettingsServerError ? error.status : null;
		const status = isLimitError
			? 409
			: backendStatus === 400 ||
					backendStatus === 401 ||
					backendStatus === 403 ||
					backendStatus === 409
				? backendStatus
				: 503;
		const response = NextResponse.json(
			{
				message: isLimitError
					? error.message
					: "User settings are temporarily unavailable.",
			},
			{ status },
		);
		return invalidateSessionForUnauthorizedResponse(
			response,
			request,
			session,
		);
	}
}
