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
  const isApiRequest = path.startsWith("/api/");
  const headerCorrelationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER));
  const cookieCorrelationId = normalizeCorrelationId(request.cookies.get(CORRELATION_ID_COOKIE)?.value);
  const correlationId = isApiRequest
    ? headerCorrelationId ?? cookieCorrelationId ?? generateCorrelationId()
    : generateCorrelationId();

  console.info(
    `[hubuum-http][cid=${correlationId}] ${request.method} ${path} ct=${contentType} accept=${accept}`
  );

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(CORRELATION_ID_HEADER, correlationId);
  const response = NextResponse.next({
    request: {
      headers: forwardedHeaders
    }
  });

  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  const shouldUpdateCookie = isApiRequest ? !headerCorrelationId && cookieCorrelationId !== correlationId : true;
  if (shouldUpdateCookie) {
    response.cookies.set(CORRELATION_ID_COOKIE, correlationId, {
      httpOnly: true,
      secure: requestIsHttps(request),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 30
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|theme-init.js).*)"]
};
