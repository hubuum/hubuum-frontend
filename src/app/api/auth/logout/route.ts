import { NextRequest, NextResponse } from "next/server";

import { backendFetchRaw } from "@/lib/api/backend";
import { getGetApiV0AuthLogoutUrl } from "@/lib/api/generated/client";
import {
  clearSessionCookie,
  destroySession,
  getSessionFromRequest
} from "@/lib/auth/session";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";
import type { MessageResponse } from "@/lib/api/generated/models";

async function performLogout(request: NextRequest) {
  const correlationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? "-";
  console.info(
    `[hubuum-auth][cid=${correlationId}] logout request received (${request.method} ${request.nextUrl.pathname})`
  );
  const session = await getSessionFromRequest(request);

  if (session) {
    await backendFetchRaw(getGetApiV0AuthLogoutUrl(), {
      correlationId,
      method: "GET",
      token: session.token
    }).catch(() => {
      // Continue local logout even if backend logout fails.
    });

    await destroySession(session.sid);
  } else {
    console.info(`[hubuum-auth][cid=${correlationId}] logout request had no active session`);
  }

  const payload: MessageResponse = {
    message: "Logged out."
  };
  const response = NextResponse.json(payload, { status: 200 });
  clearSessionCookie(response, request);
  console.info(`[hubuum-auth][cid=${correlationId}] logout completed`);
  return response;
}

export async function GET(request: NextRequest) {
  return performLogout(request);
}

export async function POST(request: NextRequest) {
  return performLogout(request);
}
