import { headers } from "next/headers";
import Link from "next/link";

import { QuickAccessPanel } from "@/components/quick-access-panel";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	type CountsWithOptionalCollections,
	getTotalCollections,
	tryFetchMetaCounts,
} from "@/lib/meta";

type RecommendedAction = {
	title: string;
	description: string;
	primaryHref: string;
	primaryLabel: string;
	secondaryHref: string;
	secondaryLabel: string;
};

// Icon components for action cards
function IconCollection({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Collection icon"
		>
			<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
		</svg>
	);
}

function IconClass({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Class icon"
		>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M7 7h10M7 12h10M7 17h10" />
		</svg>
	);
}

function IconObject({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Object icon"
		>
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

function IconRelation({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Relation icon"
		>
			<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
		</svg>
	);
}

function IconReport({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Export icon"
		>
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
		</svg>
	);
}

function IconImport({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Import icon"
		>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" x2="12" y1="15" y2="3" />
		</svg>
	);
}

function IconStatistics({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Statistics icon"
		>
			<line x1="12" x2="12" y1="20" y2="10" />
			<line x1="18" x2="18" y1="20" y2="4" />
			<line x1="6" x2="6" y1="20" y2="16" />
		</svg>
	);
}

function IconUser({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="User icon"
		>
			<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</svg>
	);
}

function IconTasks({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Tasks icon"
		>
			<path d="M9 6h11M9 12h11M9 18h11" />
			<path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
		</svg>
	);
}

function IconAudit({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Audit icon"
		>
			<path d="M12 3 4.5 6v5.5c0 4.6 3 7.8 7.5 9.5 4.5-1.7 7.5-4.9 7.5-9.5V6z" />
			<path d="m8.5 12 2.2 2.2 4.8-5" />
		</svg>
	);
}

function getRecommendedAction(
	counts: CountsWithOptionalCollections | null,
): RecommendedAction {
	if (!counts) {
		return {
			title: "Continue exploring the workspace",
			description:
				"Pick the area you want to work in. Live counts aren't available for your account, but every workspace area is still reachable below.",
			primaryHref: "/objects",
			primaryLabel: "Open objects",
			secondaryHref: "/collections",
			secondaryLabel: "Open collections",
		};
	}

	const totalCollections = getTotalCollections(counts);
	const totalClasses = counts.total_classes;
	const totalObjects = counts.total_objects;

	if (totalCollections === 0) {
		return {
			title: "Start by creating a collection",
			description:
				"Collections are the entry point for permissions, classes, and everything else in the workspace.",
			primaryHref: "/collections?create=1",
			primaryLabel: "Create collection",
			secondaryHref: "/collections",
			secondaryLabel: "Open collections",
		};
	}

	if (totalClasses === 0) {
		return {
			title: "Define your first class",
			description:
				"Once a collection exists, classes give your objects a schema and a place to live.",
			primaryHref: "/classes?create=1",
			primaryLabel: "Create class",
			secondaryHref: "/classes",
			secondaryLabel: "Open classes",
		};
	}

	if (totalObjects === 0) {
		return {
			title: "Add your first object",
			description:
				"You have structure in place. The next useful step is adding real records to a class.",
			primaryHref: "/objects?create=1",
			primaryLabel: "Create object",
			secondaryHref: "/objects",
			secondaryLabel: "Open objects",
		};
	}

	return {
		title: "Continue with objects",
		description:
			"Most day-to-day work happens around browsing, updating, and extending existing objects.",
		primaryHref: "/objects",
		primaryLabel: "Open objects",
		secondaryHref: "/relations/classes?create=1",
		secondaryLabel: "Create relation",
	};
}

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
	const recommendedAction = getRecommendedAction(counts);
	const totalCollections = counts ? getTotalCollections(counts) : null;
	const totalClasses = counts?.total_classes ?? null;
	const totalObjects = counts?.total_objects ?? null;
	const workflowSteps = [
		{
			step: "01",
			title: "Collections",
			description: "Ownership and access boundaries",
			href: "/collections",
			count: totalCollections,
			icon: <IconCollection />,
		},
		{
			step: "02",
			title: "Classes",
			description: "Schemas for structured records",
			href: "/classes",
			count: totalClasses,
			icon: <IconClass />,
		},
		{
			step: "03",
			title: "Objects",
			description: "The records your teams operate",
			href: "/objects",
			count: totalObjects,
			icon: <IconObject />,
		},
		{
			step: "04",
			title: "Relations",
			description: "Connections across the graph",
			href: "/relations",
			count: null,
			icon: <IconRelation />,
		},
	];
	const operationLinks = [
		{
			title: "Imports",
			description: "Bring structured data in",
			href: "/imports",
			icon: <IconImport />,
		},
		{
			title: "Exports",
			description: "Render and deliver scoped data",
			href: "/exports",
			icon: <IconReport />,
		},
		{
			title: "Tasks",
			description: "Monitor background work",
			href: "/tasks",
			icon: <IconTasks />,
		},
		{
			title: "Audit",
			description: "Trace changes and events",
			href: "/audit",
			icon: <IconAudit />,
		},
		...(canViewAdmin
			? [
					{
						title: "Statistics",
						description: "Review system health",
						href: "/statistics",
						icon: <IconStatistics />,
					},
					{
						title: "Access",
						description: "Manage users and groups",
						href: "/admin",
						icon: <IconUser />,
					},
				]
			: []),
	];

	return (
		<div className="workspace-dashboard">
			<header className="card workspace-hero">
				<div className="workspace-hero-copy">
					<p className="eyebrow">Knowledge graph</p>
					<h2>Welcome back, {session.username ?? "admin"}.</h2>
					<p className="muted">
						Your model is active and ready for the next change. Continue where
						you left off or move through the graph below.
					</p>
				</div>
				<dl className="workspace-metrics">
					<div>
						<dt>Collections</dt>
						<dd>{totalCollections ?? "—"}</dd>
					</div>
					<div>
						<dt>Classes</dt>
						<dd>{totalClasses ?? "—"}</dd>
					</div>
					<div>
						<dt>Objects</dt>
						<dd>{totalObjects?.toLocaleString() ?? "—"}</dd>
					</div>
				</dl>
			</header>

			<div className="workspace-dashboard-grid">
				<section className="dashboard-primary">
					<article className="card home-priority-card dashboard-priority">
					<div className="stack action-card-header">
						<p className="eyebrow">Recommended next step</p>
						<h3>{recommendedAction.title}</h3>
						<p className="muted">{recommendedAction.description}</p>
					</div>

					<div className="action-card-actions">
						<Link className="link-chip" href={recommendedAction.primaryHref}>
							{recommendedAction.primaryLabel}
						</Link>
						<Link className="link-chip" href={recommendedAction.secondaryHref}>
							{recommendedAction.secondaryLabel}
						</Link>
					</div>
					</article>

					<section className="card workflow-panel">
						<header className="section-heading">
							<div>
								<p className="eyebrow">Data model</p>
								<h3>Move through the graph</h3>
							</div>
							<p className="muted">Four layers, one connected workspace.</p>
						</header>
						<div className="workflow-path">
							{workflowSteps.map((item) => (
								<Link key={item.title} className="workflow-step" href={item.href}>
									<span className="workflow-step-number">{item.step}</span>
									<span className="workflow-step-icon">{item.icon}</span>
									<span className="workflow-step-copy">
										<strong>{item.title}</strong>
										<small>{item.description}</small>
									</span>
									<span className="workflow-step-count">
										{item.count?.toLocaleString() ?? "Explore"}
									</span>
								</Link>
							))}
						</div>
					</section>
				</section>

				<aside className="dashboard-rail">
					<QuickAccessPanel />
					<section className="card operations-panel">
						<header className="section-heading">
							<div>
								<p className="eyebrow">Operations</p>
								<h3>Run and observe</h3>
							</div>
						</header>
						<div className="operation-links">
							{operationLinks.map((item) => (
								<Link key={item.title} className="operation-link" href={item.href}>
									<span className="operation-link-icon">{item.icon}</span>
									<span>
										<strong>{item.title}</strong>
										<small>{item.description}</small>
									</span>
									<span className="operation-link-arrow" aria-hidden="true">
										→
									</span>
								</Link>
							))}
						</div>
					</section>
				</aside>
			</div>
		</div>
	);
}
