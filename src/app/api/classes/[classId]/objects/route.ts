import { NextRequest, NextResponse } from "next/server";

import { backendFetchRaw } from "@/lib/api/backend";
import { getGetApiV1ClassesByClassIdTrailingUrl } from "@/lib/api/generated/client";
import {
  clearSessionCookie,
  destroySession,
  getSessionFromRequest
} from "@/lib/auth/session";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";

type RouteContext = {
  params: Promise<{
    classId: string;
  }>;
};

function parseClassId(rawClassId: string): number | null {
  const parsed = Number.parseInt(rawClassId, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

async function proxyClassObjects(request: NextRequest, context: RouteContext) {
  const correlationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? "-";
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return NextResponse.json(
      { error: "MethodNotAllowed", message: `${method} is not supported.` },
      {
        status: 405,
        headers: {
          [CORRELATION_ID_HEADER]: correlationId
        }
      }
    );
  }

  const resolvedParams = await context.params;
  const classId = parseClassId(resolvedParams.classId);
  if (classId === null) {
    return NextResponse.json(
      { error: "BadRequest", message: "classId must be a positive integer." },
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

  const upstreamHeaders = new Headers();
  const incomingContentType = request.headers.get("content-type");
  if (incomingContentType) {
    upstreamHeaders.set("Content-Type", incomingContentType);
  }

  const body = method === "POST" ? await request.text() : undefined;
  const upstream = await backendFetchRaw(getGetApiV1ClassesByClassIdTrailingUrl(classId), {
    correlationId,
    method,
    token: session.token,
    headers: upstreamHeaders,
    body
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

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyClassObjects(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyClassObjects(request, context);
}
