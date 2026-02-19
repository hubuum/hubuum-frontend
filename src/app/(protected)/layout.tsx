import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";

export default async function ProtectedLayout({
  children
}: {
  children: ReactNode;
}) {
  const requestHeaders = await headers();
  const correlationId = normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ?? undefined;
  const session = await requireServerSession();
  const canViewAdmin = await hasAdminAccess(session.token, correlationId);

  return <AppShell canViewAdmin={canViewAdmin}>{children}</AppShell>;
}
