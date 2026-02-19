import { headers } from "next/headers";

import { backendFetchJson } from "@/lib/api/backend";
import { requireServerSession } from "@/lib/auth/guards";
import { getGetApiV0MetaCountsUrl, getGetApiV0MetaDbUrl } from "@/lib/api/generated/client";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";
import type { CountsResponse, DbStateResponse } from "@/lib/api/generated/models";

type CountsWithOptionalNamespaces = CountsResponse & {
  total_namespaces?: number;
};

export default async function AppPage() {
  const requestHeaders = await headers();
  const correlationId = normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ?? undefined;
  const session = await requireServerSession();

  const [counts, db] = await Promise.all([
    backendFetchJson<CountsWithOptionalNamespaces>(getGetApiV0MetaCountsUrl(), {
      correlationId,
      token: session.token
    }),
    backendFetchJson<DbStateResponse>(getGetApiV0MetaDbUrl(), {
      correlationId,
      token: session.token
    })
  ]);
  const totalNamespaces = Number.isFinite(counts.total_namespaces) ? counts.total_namespaces : 0;

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Overview</p>
        <h2>System snapshot</h2>
      </header>

      <div className="grid cols-2">
        <article className="card">
          <h3 className="stat-card-title">Counts</h3>
          <ul className="stat-list">
            <li>
              <span>Total classes</span>
              <strong>{counts.total_classes}</strong>
            </li>
            <li>
              <span>Total objects</span>
              <strong>{counts.total_objects}</strong>
            </li>
            <li>
              <span>Total namespaces</span>
              <strong>{totalNamespaces}</strong>
            </li>
          </ul>
        </article>

        <article className="card">
          <h3 className="stat-card-title">Database</h3>
          <ul className="stat-list">
            <li>
              <span>DB size</span>
              <strong>{db.db_size}</strong>
            </li>
            <li>
              <span>Active connections</span>
              <strong>{db.active_connections}</strong>
            </li>
            <li>
              <span>Idle connections</span>
              <strong>{db.idle_connections}</strong>
            </li>
            <li>
              <span>Available connections</span>
              <strong>{db.available_connections}</strong>
            </li>
          </ul>
        </article>
      </div>
    </section>
  );
}
