import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { backendFetchRaw } from "@/lib/api/backend";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";
import { getPostApiV0AuthLoginUrl } from "@/lib/api/generated/client";
import type { ApiErrorResponse, LoginResponse, LoginUser } from "@/lib/api/generated/models";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

type ParsedCredentials =
  | { credentials: LoginUser; fromForm: boolean }
  | { credentials: null; fromForm: boolean };

function seeOther(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "no-store"
    }
  });
}

async function parseCredentials(request: NextRequest): Promise<ParsedCredentials> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as unknown;
      return { credentials: loginSchema.parse(body), fromForm: false };
    }

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const body = {
        username: formData.get("username"),
        password: formData.get("password")
      };
      return { credentials: loginSchema.parse(body), fromForm: true };
    }
  } catch {
    // Fall through to null credentials.
  }

  return { credentials: null, fromForm: false };
}

export async function POST(request: NextRequest) {
  const correlationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? "-";
  console.info(
    `[hubuum-auth][cid=${correlationId}] login request received (${request.method} ${request.nextUrl.pathname})`
  );
  const { credentials, fromForm } = await parseCredentials(request);
  console.info(
    `[hubuum-auth][cid=${correlationId}] parsed credentials fromForm=${String(fromForm)} hasCredentials=${String(Boolean(credentials))}`
  );

  if (!credentials) {
    console.warn(`[hubuum-auth][cid=${correlationId}] login payload parse failed`);
    if (fromForm) {
      return seeOther("/login?error=invalid_credentials");
    }
    return NextResponse.json(
      {
        error: "BadRequest",
        message: "Invalid login payload"
      },
      { status: 400 }
    );
  }

  const upstream = await backendFetchRaw(getPostApiV0AuthLoginUrl(), {
    correlationId,
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(credentials)
  });

  const payload = (await upstream.json().catch(() => null)) as LoginResponse | ApiErrorResponse | null;
  console.info(`[hubuum-auth][cid=${correlationId}] backend login status=${upstream.status}`);

  if (!upstream.ok) {
    if (fromForm) {
      return seeOther("/login?error=invalid_credentials");
    }
    return NextResponse.json(
      payload ?? {
        error: "AuthenticationFailed",
        message: "Login failed"
      },
      { status: upstream.status }
    );
  }

  const token = (payload as LoginResponse | null)?.token;
  if (!token) {
    return NextResponse.json(
      {
        error: "AuthProtocolError",
        message: "Backend did not return a token"
      },
      { status: 502 }
    );
  }

  const sid = await createSession(token);
  const response = fromForm ? seeOther("/app") : NextResponse.json({ authenticated: true }, { status: 200 });
  setSessionCookie(response, sid, request, token);
  console.info(
    `[hubuum-auth][cid=${correlationId}] login succeeded and session created (fromForm=${String(fromForm)})`
  );

  return response;
}
