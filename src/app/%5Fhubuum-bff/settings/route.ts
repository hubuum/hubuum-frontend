import { NextRequest, NextResponse } from "next/server";

import { getCurrentPrincipalId } from "@/lib/auth/current-principal";
import { getSessionFromRequest } from "@/lib/auth/session";
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

async function getRequestIdentity(request: NextRequest) {
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await getSessionFromRequest(request);
	if (!session) return null;

	const principalId = await getCurrentPrincipalId(session.token, correlationId);
	return principalId
		? { principalId, token: session.token, correlationId }
		: null;
}

export async function GET(request: NextRequest) {
	const identity = await getRequestIdentity(request);
	if (!identity) {
		return NextResponse.json(
			{ message: "Authentication required." },
			{ status: 401 },
		);
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
		return NextResponse.json(
			{ message: "User settings are temporarily unavailable." },
			{ status },
		);
	}
}

export async function PATCH(request: NextRequest) {
	const identity = await getRequestIdentity(request);
	if (!identity) {
		return NextResponse.json(
			{ message: "Authentication required." },
			{ status: 401 },
		);
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
		return NextResponse.json(
			await patchUserSettingsForPrincipal(identity, updates),
		);
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
		return NextResponse.json(
			{
				message: isLimitError
					? error.message
					: "User settings are temporarily unavailable.",
			},
			{ status },
		);
	}
}
