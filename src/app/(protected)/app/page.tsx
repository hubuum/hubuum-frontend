import { headers } from "next/headers";

import { QuickAccessPanel } from "@/components/quick-access-panel";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	getTotalCollections,
	tryFetchMetaCounts,
} from "@/lib/meta";
import { fetchVisibleWorkspaceSummary } from "@/lib/workspace-summary";

export default async function AppPage() {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await requireServerSession();
	const canViewAdmin = await hasAdminAccess(session.token, correlationId);
	const counts = canViewAdmin
		? await tryFetchMetaCounts(session.token, correlationId)
		: null;
	const visibleSummary = canViewAdmin
		? null
		: await fetchVisibleWorkspaceSummary(session.token, correlationId);
	const totalCollections = counts ? getTotalCollections(counts) : null;
	const totalClasses = counts?.total_classes ?? null;
	const totalObjects = counts?.total_objects ?? null;
	const dashboardMetrics = counts
		? [
				{ label: "Collections", value: totalCollections },
				{ label: "Classes", value: totalClasses },
				{ label: "Objects", value: totalObjects },
			]
		: [
				{
					label: "Visible collections",
					value: visibleSummary?.collections ?? null,
				},
				{ label: "Visible classes", value: visibleSummary?.classes ?? null },
				{ label: "Available tasks", value: visibleSummary?.tasks ?? null },
			].filter((metric) => metric.value !== null);
	return (
		<div className="workspace-dashboard">
			<header className="card workspace-hero">
				<div className="workspace-hero-copy">
					<h2>Welcome back, {session.username ?? "admin"}.</h2>
				</div>
				{dashboardMetrics.length > 0 ? (
					<dl className="workspace-metrics">
						{dashboardMetrics.map((metric) => (
							<div key={metric.label}>
								<dt>{metric.label}</dt>
								<dd>{metric.value?.toLocaleString()}</dd>
							</div>
						))}
					</dl>
				) : null}
			</header>

			<QuickAccessPanel />
		</div>
	);
}
