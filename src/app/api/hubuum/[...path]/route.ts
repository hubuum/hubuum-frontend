import { NextRequest, NextResponse } from "next/server";

import { buildBackendUrl, getSafeBackendPathForLogs } from "@/lib/api/backend";
import {
  clearSessionCookie,
  destroySession,
  getSessionFromRequest
} from "@/lib/auth/session";
import {
  CORRELATION_ID_HEADER,
  generateCorrelationId,
  normalizeCorrelationId
} from "@/lib/correlation";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

function toUpstreamPath(pathParts: string[], preserveTrailingSlash: boolean): string | null {
  if (!pathParts.length) {
    return null;
  }

  const joinedBase = pathParts.join("/");
  const joined = preserveTrailingSlash && !joinedBase.endsWith("/") ? `${joinedBase}/` : joinedBase;
  if (!joined.startsWith("api/")) {
    return null;
  }

  return `/${joined}`;
}

async function proxyToBackend(request: NextRequest, context: RouteContext) {
  const method = request.method.toUpperCase();
  const correlationId =
    normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? generateCorrelationId();

  if (!ALLOWED_METHODS.has(method)) {
    console.warn(
      `[hubuum-proxy][cid=${correlationId}] !! ${method} ${request.nextUrl.pathname} 405 method-not-allowed`
    );
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
  const preserveTrailingSlash = request.nextUrl.pathname.length > 1 && request.nextUrl.pathname.endsWith("/");
  const path = toUpstreamPath(resolvedParams.path, preserveTrailingSlash);
  if (!path) {
    console.warn(
      `[hubuum-proxy][cid=${correlationId}] !! ${method} ${request.nextUrl.pathname} 400 bad-path`
    );
    return NextResponse.json(
      { error: "BadRequest", message: "Path must begin with api/." },
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
    console.warn(`[hubuum-proxy][cid=${correlationId}] !! ${method} ${request.nextUrl.pathname} 401 no-session`);
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
  const incomingAccept = request.headers.get("accept");

  if (incomingContentType) {
    upstreamHeaders.set("content-type", incomingContentType);
  }

  if (incomingAccept) {
    upstreamHeaders.set("accept", incomingAccept);
  }

  upstreamHeaders.set("authorization", `Bearer ${session.token}`);
  upstreamHeaders.set(CORRELATION_ID_HEADER, correlationId);

  const bodyAllowed = method !== "GET" && method !== "HEAD";
  const body = bodyAllowed ? await request.text() : undefined;

  const targetUrl = new URL(buildBackendUrl(path));
  targetUrl.search = request.nextUrl.search;
  const safePath = getSafeBackendPathForLogs(`${path}${request.nextUrl.search}`);
  const startedAt = Date.now();
  console.info(
    `[hubuum-proxy][cid=${correlationId}] -> ${method} ${safePath} (source=${request.nextUrl.pathname})`
  );

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      body: bodyAllowed ? body : undefined,
      cache: "no-store"
    });
    console.info(
      `[hubuum-proxy][cid=${correlationId}] <- ${method} ${safePath} ${upstreamResponse.status} ${Date.now() - startedAt}ms`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[hubuum-proxy][cid=${correlationId}] !! ${method} ${safePath} ${Date.now() - startedAt}ms ${message}`
    );
    return NextResponse.json(
      { error: "UpstreamUnavailable", message: "Failed to reach backend service." },
      {
        status: 502,
        headers: {
          [CORRELATION_ID_HEADER]: correlationId
        }
      }
    );
  }

  const responseBody = await upstreamResponse.text();
  const response = new NextResponse(responseBody, {
    status: upstreamResponse.status
  });

  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) {
    response.headers.set("content-type", contentType);
  }
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  if (upstreamResponse.status === 401) {
    await destroySession(session.sid);
    clearSessionCookie(response, request);
  }

  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyToBackend(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyToBackend(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyToBackend(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyToBackend(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyToBackend(request, context);
}
