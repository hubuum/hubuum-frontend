import { headers } from "next/headers";
import Link from "next/link";

import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	getTotalNamespaces,
	tryFetchSystemMetaSnapshot,
} from "@/lib/meta";

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "n/a";
	}

	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

export default async function StatisticsPage() {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await requireServerSession();
	const canViewAdmin = await hasAdminAccess(session.token, correlationId);

	if (!canViewAdmin) {
		return (
			<section className="stack">
				<header className="stack action-card-header">
					<div className="stack action-card-header">
						<p className="eyebrow">Statistics</p>
						<h2>Administrator access required</h2>
					</div>
					<p className="muted">
						System counts, database status, and global task state are only
						available to administrators.
					</p>
				</header>

				<article className="card stack panel-card">
					<p className="muted">
						Use the tasks workspace for task activity available to your account.
					</p>
					<div className="action-card-actions">
						<Link className="link-chip" href="/tasks">
							Open tasks
						</Link>
						<Link className="link-chip" href="/app">
							Back home
						</Link>
					</div>
				</article>
			</section>
		);
	}

	const snapshot = await tryFetchSystemMetaSnapshot(session.token, correlationId);

	if (!snapshot) {
		return (
			<section className="stack">
				<header className="stack action-card-header">
					<div className="stack action-card-header">
						<p className="eyebrow">Statistics</p>
						<h2>Administrator access required</h2>
					</div>
					<p className="muted">
						The backend denied access to system metadata for this account.
					</p>
				</header>

				<article className="card stack panel-card">
					<p className="muted">
						Use the tasks workspace for task activity available to your account.
					</p>
					<div className="action-card-actions">
						<Link className="link-chip" href="/tasks">
							Open tasks
						</Link>
						<Link className="link-chip" href="/app">
							Back home
						</Link>
					</div>
				</article>
			</section>
		);
	}

	const { counts, db, tasks } = snapshot;
	const totalNamespaces = getTotalNamespaces(counts);

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Statistics</p>
					<h2>System snapshot</h2>
				</div>
				<p className="muted">
					Counts and database status for the current Hubuum environment.
				</p>
			</header>

			<div className="stats-grid">
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
						<li>
							<span>Last vacuum</span>
							<strong>{formatTimestamp(db.last_vacuum_time ?? null)}</strong>
						</li>
					</ul>
				</article>

				<article className="card">
					<h3 className="stat-card-title">Task system</h3>
					<ul className="stat-list">
						<li>
							<span>Actix workers</span>
							<strong>{tasks.actix_workers}</strong>
						</li>
						<li>
							<span>Task workers</span>
							<strong>{tasks.configured_task_workers}</strong>
						</li>
						<li>
							<span>Poll interval</span>
							<strong>{tasks.task_poll_interval_ms} ms</strong>
						</li>
						<li>
							<span>Total tasks</span>
							<strong>{tasks.total_tasks}</strong>
						</li>
						<li>
							<span>Queued / active</span>
							<strong>
								{tasks.queued_tasks} / {tasks.active_tasks}
							</strong>
						</li>
						<li>
							<span>Validating / running</span>
							<strong>
								{tasks.validating_tasks} / {tasks.running_tasks}
							</strong>
						</li>
						<li>
							<span>Succeeded / partial</span>
							<strong>
								{tasks.succeeded_tasks} / {tasks.partially_succeeded_tasks}
							</strong>
						</li>
						<li>
							<span>Failed / cancelled</span>
							<strong>
								{tasks.failed_tasks} / {tasks.cancelled_tasks}
							</strong>
						</li>
						<li>
							<span>Import / report tasks</span>
							<strong>
								{tasks.import_tasks} / {tasks.report_tasks}
							</strong>
						</li>
						<li>
							<span>Export / reindex tasks</span>
							<strong>
								{tasks.export_tasks} / {tasks.reindex_tasks}
							</strong>
						</li>
						<li>
							<span>Total task events</span>
							<strong>{tasks.total_task_events}</strong>
						</li>
						<li>
							<span>Import result rows</span>
							<strong>{tasks.total_import_result_rows}</strong>
						</li>
						<li>
							<span>Oldest queued</span>
							<strong>{formatTimestamp(tasks.oldest_queued_at)}</strong>
						</li>
						<li>
							<span>Oldest active</span>
							<strong>{formatTimestamp(tasks.oldest_active_at)}</strong>
						</li>
					</ul>
				</article>
			</div>
		</section>
	);
}
