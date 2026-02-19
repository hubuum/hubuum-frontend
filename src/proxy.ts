import { NextRequest, NextResponse } from "next/server";

import {
  CORRELATION_ID_COOKIE,
  CORRELATION_ID_HEADER,
  generateCorrelationId,
  normalizeCorrelationId
} from "@/lib/correlation";

function isHtmlNavigationRequest(request: NextRequest): boolean {
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  return request.method.toUpperCase() === "GET" && accept.includes("text/html");
}

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
  const existingCorrelationId = headerCorrelationId ?? cookieCorrelationId;
  const correlationId = isHtmlNavigationRequest(request)
    ? generateCorrelationId()
    : (existingCorrelationId ?? generateCorrelationId());

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(CORRELATION_ID_HEADER, correlationId);

  console.info(
    `[hubuum-http][cid=${correlationId}] ${request.method} ${path} ct=${contentType} accept=${accept}`
  );

  const response = NextResponse.next({
    request: {
      headers: forwardedHeaders
    }
  });
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  response.cookies.set(CORRELATION_ID_COOKIE, correlationId, {
    httpOnly: true,
    secure: requestIsHttps(request),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 30
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"]
};
