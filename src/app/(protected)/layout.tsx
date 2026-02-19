import Link from "next/link";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
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

  return (
    <div className="app-layout">
      <aside className="sidebar card">
        <div className="sidebar-main">
          <div>
            <p className="eyebrow">Hubuum</p>
            <h1>Console</h1>
          </div>

          <nav>
            <div className="sidebar-group">
              <p className="sidebar-label">Workspace</p>
              <Link href="/app">Overview</Link>
              <Link href="/namespaces">Namespaces</Link>
              <Link href="/classes">Classes</Link>
              <Link href="/objects">Objects</Link>
              <Link href="/relations">Relations</Link>
            </div>

            {canViewAdmin ? (
              <div className="sidebar-group">
                <p className="sidebar-label">Admin</p>
                <Link href="/admin/users">Users</Link>
                <Link href="/admin/groups">Groups</Link>
              </div>
            ) : null}
          </nav>
        </div>

        <div className="sidebar-footer">
          <LogoutButton />
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
