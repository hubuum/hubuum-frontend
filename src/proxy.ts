import { NextRequest, NextResponse } from "next/server";

import {
  CORRELATION_ID_COOKIE,
  CORRELATION_ID_HEADER,
  generateCorrelationId,
  normalizeCorrelationId
} from "@/lib/correlation";

function requestIsHttps(request: NextRequest): boolean {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();
  const requestProto = request.nextUrl.protocol.replace(":", "").toLowerCase();
  const effectiveProto = forwardedProto || requestProto;
  return effectiveProto === "https";
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const contentType = request.headers.get("content-type") ?? "-";
  const accept = request.headers.get("accept") ?? "-";
  const headerCorrelationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER));
  const cookieCorrelationId = normalizeCorrelationId(request.cookies.get(CORRELATION_ID_COOKIE)?.value);
  const correlationId = headerCorrelationId ?? cookieCorrelationId ?? generateCorrelationId();

  console.info(
    `[hubuum-http][cid=${correlationId}] ${request.method} ${path} ct=${contentType} accept=${accept}`
  );

  const response = (() => {
    if (!path.startsWith("/api/")) {
      return NextResponse.next();
    }

    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.set(CORRELATION_ID_HEADER, correlationId);
    const nextResponse = NextResponse.next({
      request: {
        headers: forwardedHeaders
      }
    });
    nextResponse.headers.set(CORRELATION_ID_HEADER, correlationId);
    if (cookieCorrelationId !== correlationId) {
      nextResponse.cookies.set(CORRELATION_ID_COOKIE, correlationId, {
        httpOnly: true,
        secure: requestIsHttps(request),
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 30
      });
    }
    return nextResponse;
  })();

  return response;
}

export const config = {
  matcher: ["/api/:path*"]
};
