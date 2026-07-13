import "server-only";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSessionStore, type SessionPayload } from "@/lib/auth/session-store";
import { getServerEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "hubuum.sid";
const LEGACY_SESSION_TOKEN_COOKIE_NAME = "hubuum.token";
const LEGACY_SESSION_USERNAME_COOKIE_NAME = "hubuum.username";

export type ActiveSession = SessionPayload & { sid: string };

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

async function hydrateSession(sid: string): Promise<ActiveSession | null> {
	const store = getSessionStore();
	const payload = await store.get(sid);
	if (!payload) {
		return null;
	}

	const touched: SessionPayload = {
		...payload,
		lastSeen: Date.now(),
	};

	await store.touch(sid, touched);

	return {
		sid,
		...touched,
	};
}

export async function createSession(
	token: string,
	username?: string,
): Promise<string> {
	const sid = crypto.randomUUID();
	const now = Date.now();
	const payload: SessionPayload = {
		token,
		username,
		createdAt: now,
		lastSeen: now,
	};

	await getSessionStore().create(sid, payload);
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
	await getSessionStore().destroy(sid);
}

export function setSessionCookie(
	response: NextResponse,
	sid: string,
	request?: NextRequest,
): void {
	const settings = cookieSettings(request);
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
