import { NextRequest, NextResponse } from "next/server";

import { backendFetchRaw } from "@/lib/api/backend";
import { clearSessionCookie, destroySession, getSessionFromRequest } from "@/lib/auth/session";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";

type RouteContext = {
  params: Promise<{
    classId: string;
    objectId: string;
  }>;
};

function parseId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? "-";
  const resolvedParams = await context.params;
  const classId = parseId(resolvedParams.classId);
  const objectId = parseId(resolvedParams.objectId);

  if (classId === null || objectId === null) {
    return NextResponse.json(
      { error: "BadRequest", message: "classId and objectId must be positive integers." },
      {
        status: 400,
        headers: {
          [CORRELATION_ID_HEADER]: correlationId
        }
      }
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Sign in required." },
      {
        status: 401,
        headers: {
          [CORRELATION_ID_HEADER]: correlationId
        }
      }
    );
  }

  const upstream = await backendFetchRaw(`/api/v1/classes/${classId}/${objectId}/relations/`, {
    correlationId,
    method: "GET",
    token: session.token
  });

  const responseBody = await upstream.text();
  const response = new NextResponse(responseBody, {
    status: upstream.status
  });
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    response.headers.set("content-type", contentType);
  }
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  if (upstream.status === 401) {
    await destroySession(session.sid);
    clearSessionCookie(response, request);
  }

  return response;
}
