import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";

export async function GET(request: NextRequest) {
  const correlationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? "-";
  const session = await getSessionFromRequest(request);

  if (!session) {
    console.info(`[hubuum-auth][cid=${correlationId}] session check: unauthenticated`);
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  console.info(`[hubuum-auth][cid=${correlationId}] session check: authenticated`);
  return NextResponse.json({
    authenticated: true,
    createdAt: session.createdAt,
    lastSeen: session.lastSeen
  });
}
