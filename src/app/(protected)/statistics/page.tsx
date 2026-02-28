import { headers } from "next/headers";

import { requireServerSession } from "@/lib/auth/guards";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";
import { fetchDbState, fetchMetaCounts, getTotalNamespaces } from "@/lib/meta";

export default async function StatisticsPage() {
  const requestHeaders = await headers();
  const correlationId = normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ?? undefined;
  const session = await requireServerSession();

  const [counts, db] = await Promise.all([
    fetchMetaCounts(session.token, correlationId),
    fetchDbState(session.token, correlationId)
  ]);
  const totalNamespaces = getTotalNamespaces(counts);

  return (
    <section className="stack">
      <header className="stack action-card-header">
        <div className="stack action-card-header">
          <p className="eyebrow">Statistics</p>
          <h2>System snapshot</h2>
        </div>
        <p className="muted">Counts and database status for the current Hubuum environment.</p>
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
