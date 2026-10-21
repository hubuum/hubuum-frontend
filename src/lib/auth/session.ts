import "server-only";

import type { SessionResponse } from "@/lib/api/generated/models";
import { sessionPayload } from "@/lib/auth/session-credentials";
import { refreshSession } from "@/lib/auth/session-refresh";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { invalidateBackendSessionValidation } from "@/lib/auth/backend-session-validation";
import { invalidateProtectedLayoutBootstrap } from "@/lib/auth/protected-layout-bootstrap";
import { getSessionStore, type SessionPayload } from "@/lib/auth/session-store";
import { shouldTouchSession } from "@/lib/auth/session-touch";
import { getServerEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "hubuum.sid";
const LEGACY_SESSION_TOKEN_COOKIE_NAME = "hubuum.token";
const LEGACY_SESSION_USERNAME_COOKIE_NAME = "hubuum.username";

export type ActiveSession = SessionPayload & { sid: string };

const pendingSessionHydrations = new Map<
	string,
	Promise<ActiveSession | null>
>();

function shouldUseSecureCookies(request?: NextRequest): boolean {
	const env = getServerEnv();

	if (env.NODE_ENV !== "production") {
		return false;
	}

	if (!request) {
		return true;
	}

	const forwardedProto = request.headers
		.get("x-forwarded-proto")
		?.split(",")[0]
		?.trim()
		.toLowerCase();
	const requestProto = request.nextUrl.protocol.replace(":", "").toLowerCase();
	const effectiveProto = forwardedProto || requestProto;

	// Use secure cookies only when the external request scheme is HTTPS.
	return effectiveProto === "https";
}

function cookieSettings(request?: NextRequest) {
	const env = getServerEnv();
	return {
		httpOnly: true,
		secure: shouldUseSecureCookies(request),
		sameSite: "lax" as const,
		path: "/",
		maxAge: env.SESSION_TTL_SECONDS,
	};
}

async function loadSession(sid: string): Promise<ActiveSession | null> {
	const store = getSessionStore();
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const stored = await store.get(sid);
		if (!stored) return null;
		const payload = await refreshSession(store, sid, stored);
		if (!payload) return null;
		if (payload.generation !== stored.generation) {
			invalidateBackendSessionValidation(sid);
			invalidateProtectedLayoutBootstrap(sid);
		}
		const now = Date.now();
		if (
			!shouldTouchSession(
				payload.lastSeen,
				now,
				getServerEnv().SESSION_TTL_SECONDS,
			)
		) {
			return { sid, ...payload };
		}
		const touched: SessionPayload = { ...payload, lastSeen: now };
		if (await store.touch(sid, touched)) return { sid, ...touched };
		// A concurrent rotation won; reload its complete pair before proceeding.
	}
	return null;
}

async function hydrateSession(sid: string): Promise<ActiveSession | null> {
	const pending = pendingSessionHydrations.get(sid);
	if (pending) {
		return pending;
	}

	const hydration = loadSession(sid);
	pendingSessionHydrations.set(sid, hydration);

	try {
		return await hydration;
	} finally {
		if (pendingSessionHydrations.get(sid) === hydration) {
			pendingSessionHydrations.delete(sid);
		}
	}
}

export async function createSession(
	credentials: SessionResponse,
	username?: string,
): Promise<string> {
	const sid = crypto.randomUUID();
	await getSessionStore().create(sid, sessionPayload(credentials, username));
	return sid;
}

export async function getSessionFromRequest(
	request: NextRequest,
): Promise<ActiveSession | null> {
	const sid = request.cookies.get(SESSION_COOKIE_NAME)?.value;
	if (!sid) {
		return null;
	}

	return hydrateSession(sid);
}

export async function getSessionFromServerCookies(): Promise<ActiveSession | null> {
	const cookieStore = await Promise.resolve(cookies());
	const sid = cookieStore.get(SESSION_COOKIE_NAME)?.value;
	if (!sid) {
		return null;
	}

	return hydrateSession(sid);
}

export async function destroySession(sid: string): Promise<void> {
	pendingSessionHydrations.delete(sid);
	invalidateBackendSessionValidation(sid);
	invalidateProtectedLayoutBootstrap(sid);
	await getSessionStore().destroy(sid);
}

export function setSessionCookie(
	response: NextResponse,
	sid: string,
	expiresAt: number,
	request?: NextRequest,
): void {
	const settings = {
		...cookieSettings(request),
		maxAge: Math.max(
			0,
			Math.min(
				getServerEnv().SESSION_TTL_SECONDS,
				Math.floor((expiresAt - Date.now()) / 1000),
			),
		),
	};
	response.cookies.set(SESSION_COOKIE_NAME, sid, settings);
	response.cookies.set(LEGACY_SESSION_TOKEN_COOKIE_NAME, "", {
		...settings,
		maxAge: 0,
	});
	response.cookies.set(LEGACY_SESSION_USERNAME_COOKIE_NAME, "", {
		...settings,
		maxAge: 0,
	});

	const host = request?.nextUrl.host ?? "-";
	const forwardedProto = request?.headers.get("x-forwarded-proto") ?? "-";
	const requestProto = request?.nextUrl.protocol ?? "-";
	console.info(
		`[hubuum-auth] set session cookie mode=valkey (secure=${String(settings.secure)} maxAge=${settings.maxAge} host=${host} proto=${requestProto} xfp=${forwardedProto})`,
	);
}

export function clearSessionCookie(
	response: NextResponse,
	request?: NextRequest,
): void {
	response.cookies.set(SESSION_COOKIE_NAME, "", {
		...cookieSettings(request),
		maxAge: 0,
	});
	response.cookies.set(LEGACY_SESSION_TOKEN_COOKIE_NAME, "", {
		...cookieSettings(request),
		maxAge: 0,
	});
	response.cookies.set(LEGACY_SESSION_USERNAME_COOKIE_NAME, "", {
		...cookieSettings(request),
		maxAge: 0,
	});
}
