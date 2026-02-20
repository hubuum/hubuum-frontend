import "server-only";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";
import { getSessionStore, type SessionPayload } from "@/lib/auth/session-store";

export const SESSION_COOKIE_NAME = "hubuum.sid";
export const SESSION_TOKEN_COOKIE_NAME = "hubuum.token";
export const SESSION_USERNAME_COOKIE_NAME = "hubuum.username";

export type ActiveSession = SessionPayload & { sid: string };

function usesDistributedSessionStore(): boolean {
  return Boolean(getServerEnv().VALKEY_URL);
}

function encodeCookieValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCookieValue(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

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
    maxAge: env.SESSION_TTL_SECONDS
  };
}

async function hydrateSession(sid: string): Promise<ActiveSession | null> {
  if (!usesDistributedSessionStore()) {
    return null;
  }

  const store = getSessionStore();
  const payload = await store.get(sid);
  if (!payload) {
    return null;
  }

  const touched: SessionPayload = {
    ...payload,
    lastSeen: Date.now()
  };

  await store.touch(sid, touched);

  return {
    sid,
    ...touched
  };
}

export async function createSession(token: string, username?: string): Promise<string> {
  if (!usesDistributedSessionStore()) {
    // In non-distributed mode we keep the backend token in an HttpOnly cookie.
    return `cookie-${crypto.randomUUID()}`;
  }

  const sid = crypto.randomUUID();
  const now = Date.now();
  const payload: SessionPayload = {
    token,
    username,
    createdAt: now,
    lastSeen: now
  };

  await getSessionStore().create(sid, payload);
  return sid;
}

export async function getSessionFromRequest(request: NextRequest): Promise<ActiveSession | null> {
  if (usesDistributedSessionStore()) {
    const sid = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!sid) {
      return null;
    }

    return hydrateSession(sid);
  }

  const encodedToken = request.cookies.get(SESSION_TOKEN_COOKIE_NAME)?.value;
  if (!encodedToken) {
    console.warn("[hubuum-auth] no token cookie present on request");
    return null;
  }

  const token = decodeCookieValue(encodedToken);
  if (!token) {
    console.warn("[hubuum-auth] token cookie decode failed on request");
    return null;
  }

  const encodedUsername = request.cookies.get(SESSION_USERNAME_COOKIE_NAME)?.value;
  const username = encodedUsername ? decodeCookieValue(encodedUsername) ?? undefined : undefined;

  return {
    sid: "cookie-token",
    token,
    username,
    createdAt: 0,
    lastSeen: Date.now()
  };
}

export async function getSessionFromServerCookies(): Promise<ActiveSession | null> {
  const cookieStore = await Promise.resolve(cookies());
  if (usesDistributedSessionStore()) {
    const sid = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sid) {
      return null;
    }

    return hydrateSession(sid);
  }

  const encodedToken = cookieStore.get(SESSION_TOKEN_COOKIE_NAME)?.value;
  if (!encodedToken) {
    console.warn("[hubuum-auth] no token cookie present in server cookies");
    return null;
  }

  const token = decodeCookieValue(encodedToken);
  if (!token) {
    console.warn("[hubuum-auth] token cookie decode failed in server cookies");
    return null;
  }

  const encodedUsername = cookieStore.get(SESSION_USERNAME_COOKIE_NAME)?.value;
  const username = encodedUsername ? decodeCookieValue(encodedUsername) ?? undefined : undefined;

  return {
    sid: "cookie-token",
    token,
    username,
    createdAt: 0,
    lastSeen: Date.now()
  };
}

export async function destroySession(sid: string): Promise<void> {
  if (!usesDistributedSessionStore()) {
    return;
  }

  await getSessionStore().destroy(sid);
}

export function setSessionCookie(
  response: NextResponse,
  sid: string,
  request?: NextRequest,
  token?: string,
  username?: string
): void {
  const settings = cookieSettings(request);
  if (usesDistributedSessionStore()) {
    response.cookies.set(SESSION_COOKIE_NAME, sid, settings);
    response.cookies.set(SESSION_USERNAME_COOKIE_NAME, "", { ...settings, maxAge: 0 });
  } else if (token) {
    const encodedToken = encodeCookieValue(token);
    response.cookies.set(SESSION_TOKEN_COOKIE_NAME, encodedToken, settings);
    if (username) {
      const encodedUsername = encodeCookieValue(username);
      response.cookies.set(SESSION_USERNAME_COOKIE_NAME, encodedUsername, settings);
    } else {
      response.cookies.set(SESSION_USERNAME_COOKIE_NAME, "", { ...settings, maxAge: 0 });
    }
  }

  const host = request?.nextUrl.host ?? "-";
  const forwardedProto = request?.headers.get("x-forwarded-proto") ?? "-";
  const requestProto = request?.nextUrl.protocol ?? "-";
  const mode = usesDistributedSessionStore() ? "sid" : "token-cookie";
  const tokenLen = token?.length ?? 0;
  console.info(
    `[hubuum-auth] set session cookie mode=${mode} tokenLen=${tokenLen} (secure=${String(settings.secure)} maxAge=${settings.maxAge} host=${host} proto=${requestProto} xfp=${forwardedProto})`
  );
}

export function clearSessionCookie(response: NextResponse, request?: NextRequest): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...cookieSettings(request), maxAge: 0 });
  response.cookies.set(SESSION_TOKEN_COOKIE_NAME, "", { ...cookieSettings(request), maxAge: 0 });
  response.cookies.set(SESSION_USERNAME_COOKIE_NAME, "", { ...cookieSettings(request), maxAge: 0 });
}
