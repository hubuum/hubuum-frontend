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
	type CountsWithOptionalNamespaces,
	getTotalNamespaces,
	tryFetchMetaCounts,
} from "@/lib/meta";

type ActionCard = {
	title: string;
	description: string;
	primaryHref: string;
	primaryLabel: string;
	secondaryHref?: string;
	secondaryLabel?: string;
	icon: React.ReactNode;
	count?: number;
};

type RecommendedAction = {
	title: string;
	description: string;
	primaryHref: string;
	primaryLabel: string;
	secondaryHref: string;
	secondaryLabel: string;
};

// Icon components for action cards
function IconNamespace({ className }: { className?: string }) {
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
			aria-label="Namespace icon"
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
			aria-label="Report icon"
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

function getRecommendedAction(
	counts: CountsWithOptionalNamespaces | null,
): RecommendedAction {
	if (!counts) {
		return {
			title: "Continue exploring the workspace",
			description:
				"Pick the area you want to work in. Live counts aren't available for your account, but every workspace area is still reachable below.",
			primaryHref: "/objects",
			primaryLabel: "Open objects",
			secondaryHref: "/namespaces",
			secondaryLabel: "Open namespaces",
		};
	}

	const totalNamespaces = getTotalNamespaces(counts);
	const totalClasses = counts.total_classes;
	const totalObjects = counts.total_objects;

	if (totalNamespaces === 0) {
		return {
			title: "Start by creating a namespace",
			description:
				"Namespaces are the entry point for permissions, classes, and everything else in the workspace.",
			primaryHref: "/namespaces?create=1",
			primaryLabel: "Create namespace",
			secondaryHref: "/namespaces",
			secondaryLabel: "Open namespaces",
		};
	}

	if (totalClasses === 0) {
		return {
			title: "Define your first class",
			description:
				"Once a namespace exists, classes give your objects a schema and a place to live.",
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

function getActionCards(
	counts: CountsWithOptionalNamespaces | null,
	canViewAdmin: boolean,
): ActionCard[] {
	const totalNamespaces = counts ? getTotalNamespaces(counts) : 0;
	const totalClasses = counts?.total_classes ?? 0;
	const totalObjects = counts?.total_objects ?? 0;

	const cards: ActionCard[] = [
		{
			title: "Namespaces",
			description: !counts
				? "Organize ownership and permissions through namespaces."
				: totalNamespaces === 0
					? "No namespaces exist yet. Start here to establish ownership and permissions."
					: `${totalNamespaces} namespace${totalNamespaces === 1 ? "" : "s"} available for organizing classes and access.`,
			primaryHref: "/namespaces?create=1",
			primaryLabel: "Create namespace",
			secondaryHref: "/namespaces",
			secondaryLabel: "Browse namespaces",
			icon: <IconNamespace className="action-card-icon" />,
			count: counts && totalNamespaces > 0 ? totalNamespaces : undefined,
		},
		{
			title: "Classes",
			description: !counts
				? "Classes give your objects a schema and a place to live."
				: totalNamespaces === 0
					? "Classes depend on namespaces, so create a namespace first."
					: totalClasses === 0
						? "No classes yet. Define one to describe the objects your team will manage."
						: `${totalClasses} class${totalClasses === 1 ? "" : "es"} defined across the workspace.`,
			primaryHref: "/classes?create=1",
			primaryLabel: "Create class",
			secondaryHref: "/classes",
			secondaryLabel: "Browse classes",
			icon: <IconClass className="action-card-icon" />,
			count: counts && totalClasses > 0 ? totalClasses : undefined,
		},
		{
			title: "Objects",
			description: !counts
				? "Inspect and update the records that live inside your classes."
				: totalClasses === 0
					? "Objects depend on classes. Once a class exists, this becomes the main operational area."
					: totalObjects === 0
						? "No objects yet. Add the first object to start using the model."
						: `${totalObjects} object${totalObjects === 1 ? "" : "s"} currently available to inspect and update.`,
			primaryHref: "/objects?create=1",
			primaryLabel: "Create object",
			secondaryHref: "/objects",
			secondaryLabel: "Open objects",
			icon: <IconObject className="action-card-icon" />,
			count: counts && totalObjects > 0 ? totalObjects : undefined,
		},
		{
			title: "Relations",
			description:
				counts && totalClasses < 2
					? "Relations become useful once you have at least two classes or established object records."
					: "Map how classes and objects relate so navigation and reachability become meaningful.",
			primaryHref: "/relations/classes?create=1",
			primaryLabel: "Create relation",
			secondaryHref: "/relations/classes",
			secondaryLabel: "Open relations",
			icon: <IconRelation className="action-card-icon" />,
		},
		{
			title: "Reports",
			description:
				counts && totalClasses === 0
					? "Reports become useful once you have real collections to query, but you can prepare templates ahead of time."
					: "Create stored templates and run scoped reports without leaving the workspace.",
			primaryHref: "/reports",
			primaryLabel: "Open reports",
			icon: <IconReport className="action-card-icon" />,
		},
		{
			title: "Imports",
			description:
				"Submit JSON import jobs, then monitor queue state, lifecycle events, and per-item outcomes.",
			primaryHref: "/imports",
			primaryLabel: "Open imports",
			icon: <IconImport className="action-card-icon" />,
		},
	];

	if (canViewAdmin) {
		cards.push({
			title: "Statistics",
			description:
				"Review workspace counts, database health, and global task system state.",
			primaryHref: "/statistics",
			primaryLabel: "Open statistics",
			icon: <IconStatistics className="action-card-icon" />,
		});
		cards.push({
			title: "Access Management",
			description:
				"Review users and groups when you need to inspect permissions or prepare access changes.",
			primaryHref: "/admin",
			primaryLabel: "Open admin",
			secondaryHref: "/admin/users",
			secondaryLabel: "Users",
			icon: <IconUser className="action-card-icon" />,
		});
	}

	return cards;
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
	const actionCards = getActionCards(counts, canViewAdmin);

	return (
		<div className="landing-layout">
			<aside className="landing-sidebar">
				<QuickAccessPanel />
			</aside>

			<section className="landing-main stack">
				<header className="stack action-card-header">
					<div className="stack action-card-header">
						<p className="eyebrow">Home</p>
						<h2>What do you want to do?</h2>
					</div>
					<p className="muted">
						Start from the task you have in mind. Statistics and database health
						now live separately.
					</p>
				</header>

				<article className="card stack home-priority-card">
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

				<div className="grid cols-2">
					{actionCards.map((card) => (
						<article key={card.title} className="card stack action-card">
							<div className="action-card-header-with-icon">
								<div className="action-card-icon-wrapper">{card.icon}</div>
								<div className="stack action-card-header">
									<div className="action-card-title-row">
										<h3>{card.title}</h3>
										{card.count !== undefined ? (
											<span className="action-card-count">{card.count}</span>
										) : null}
									</div>
									<p className="muted">{card.description}</p>
								</div>
							</div>

							<div className="action-card-actions">
								<Link className="link-chip" href={card.primaryHref}>
									{card.primaryLabel}
								</Link>
								{card.secondaryHref && card.secondaryLabel ? (
									<Link className="link-chip" href={card.secondaryHref}>
										{card.secondaryLabel}
									</Link>
								) : null}
							</div>
						</article>
					))}
				</div>
			</section>
		</div>
	);
}
