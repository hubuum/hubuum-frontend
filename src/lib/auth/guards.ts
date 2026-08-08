import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { validateBackendSession } from "@/lib/auth/backend-session-validation";
import {
	destroySession,
	getSessionFromServerCookies,
} from "@/lib/auth/session";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { REQUEST_PATH_HEADER } from "@/lib/request-context";
import { buildSessionExpiryLoginPath } from "@/lib/session-expiry";

export async function requireServerSession() {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ?? "-";
	const session = await getSessionFromServerCookies();

	if (!session) {
		console.warn(
			`[hubuum-auth][cid=${correlationId}] no active server session, redirecting to /login`,
		);
		redirect("/login");
	}

	const validation = await validateBackendSession({
		correlationId:
			correlationId === "-" ? undefined : correlationId,
		sid: session.sid,
		token: session.token,
	});
	if (validation === "expired") {
		console.warn(
			`[hubuum-auth][cid=${correlationId}] backend session expired, redirecting to /login`,
		);
		await destroySession(session.sid);
		redirect(
			buildSessionExpiryLoginPath(
				requestHeaders.get(REQUEST_PATH_HEADER) ?? "/app",
			),
		);
	}
	if (validation === "unavailable") {
		console.warn(
			`[hubuum-auth][cid=${correlationId}] backend session validation unavailable`,
		);
	}

	console.info(
		`[hubuum-auth][cid=${correlationId}] active server session found`,
	);
	return session;
}
