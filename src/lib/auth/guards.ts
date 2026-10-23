import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { validateBackendSession } from "@/lib/auth/backend-session-validation";
import {
	getSessionFromServerCookies,
	invalidateRejectedSession,
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
	let session = await getSessionFromServerCookies();

	if (!session) {
		console.warn(
			`[hubuum-auth][cid=${correlationId}] no active server session, redirecting to /login`,
		);
		redirect("/login");
	}

	let validation = await validateBackendSession({
		correlationId:
			correlationId === "-" ? undefined : correlationId,
		sid: session.sid,
		token: session.token,
	});
	if (validation === "expired") {
		if (!(await invalidateRejectedSession(session))) {
			// Revalidate the replacement before allowing a protected render.
			session = await getSessionFromServerCookies();
			if (session) {
				validation = await validateBackendSession({
					correlationId: correlationId === "-" ? undefined : correlationId,
					sid: session.sid,
					token: session.token,
				});
				if (validation !== "expired") return session;
				if (!(await invalidateRejectedSession(session))) {
					throw new Error(
						"Session changed during validation. Reload this page.",
					);
				}
			}
		}
		console.warn(
			`[hubuum-auth][cid=${correlationId}] backend session expired, redirecting to /login`,
		);
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
