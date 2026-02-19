import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";
import { getSessionFromServerCookies } from "@/lib/auth/session";

export async function requireServerSession() {
  const requestHeaders = await headers();
  const correlationId = normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ?? "-";
  const session = await getSessionFromServerCookies();

  if (!session) {
    console.warn(`[hubuum-auth][cid=${correlationId}] no active server session, redirecting to /login`);
    redirect("/login");
  }

  console.info(`[hubuum-auth][cid=${correlationId}] active server session found`);
  return session;
}
