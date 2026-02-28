import Link from "next/link";
import { headers } from "next/headers";

import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";
import { fetchMetaCounts, getTotalNamespaces } from "@/lib/meta";

type ActionCard = {
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

type RecommendedAction = {
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
};

function getRecommendedAction(totalNamespaces: number, totalClasses: number, totalObjects: number): RecommendedAction {
  if (totalNamespaces === 0) {
    return {
      title: "Start by creating a namespace",
      description: "Namespaces are the entry point for permissions, classes, and everything else in the workspace.",
      primaryHref: "/namespaces?create=1",
      primaryLabel: "Create namespace",
      secondaryHref: "/namespaces",
      secondaryLabel: "Open namespaces"
    };
  }

  if (totalClasses === 0) {
    return {
      title: "Define your first class",
      description: "Once a namespace exists, classes give your objects a schema and a place to live.",
      primaryHref: "/classes?create=1",
      primaryLabel: "Create class",
      secondaryHref: "/classes",
      secondaryLabel: "Open classes"
    };
  }

  if (totalObjects === 0) {
    return {
      title: "Add your first object",
      description: "You have structure in place. The next useful step is adding real records to a class.",
      primaryHref: "/objects?create=1",
      primaryLabel: "Create object",
      secondaryHref: "/objects",
      secondaryLabel: "Open objects"
    };
  }

  return {
    title: "Continue with objects",
    description: "Most day-to-day work happens around browsing, updating, and extending existing objects.",
    primaryHref: "/objects",
    primaryLabel: "Open objects",
    secondaryHref: "/relations/classes?create=1",
    secondaryLabel: "Create relation"
  };
}

function getActionCards(
  totalNamespaces: number,
  totalClasses: number,
  totalObjects: number,
  canViewAdmin: boolean
): ActionCard[] {
  const cards: ActionCard[] = [
    {
      title: "Set up namespaces",
      description:
        totalNamespaces === 0
          ? "No namespaces exist yet. Start here to establish ownership and permissions."
          : `${totalNamespaces} namespace${totalNamespaces === 1 ? "" : "s"} available for organizing classes and access.`,
      primaryHref: "/namespaces?create=1",
      primaryLabel: "Create namespace",
      secondaryHref: "/namespaces",
      secondaryLabel: "Browse namespaces"
    },
    {
      title: "Define classes",
      description:
        totalNamespaces === 0
          ? "Classes depend on namespaces, so create a namespace first."
          : totalClasses === 0
            ? "No classes yet. Define one to describe the objects your team will manage."
            : `${totalClasses} class${totalClasses === 1 ? "" : "es"} defined across the workspace.`,
      primaryHref: "/classes?create=1",
      primaryLabel: "Create class",
      secondaryHref: "/classes",
      secondaryLabel: "Browse classes"
    },
    {
      title: "Work with objects",
      description:
        totalClasses === 0
          ? "Objects depend on classes. Once a class exists, this becomes the main operational area."
          : totalObjects === 0
            ? "No objects yet. Add the first object to start using the model."
            : `${totalObjects} object${totalObjects === 1 ? "" : "s"} currently available to inspect and update.`,
      primaryHref: "/objects?create=1",
      primaryLabel: "Create object",
      secondaryHref: "/objects",
      secondaryLabel: "Open objects"
    },
    {
      title: "Connect relations",
      description:
        totalClasses < 2
          ? "Relations become useful once you have at least two classes or established object records."
          : "Map how classes and objects relate so navigation and reachability become meaningful.",
      primaryHref: "/relations/classes?create=1",
      primaryLabel: "Create relation",
      secondaryHref: "/relations/classes",
      secondaryLabel: "Open relations"
    },
    {
      title: "Inspect system statistics",
      description: "Counts and database health still matter, but they no longer need to dominate the landing experience.",
      primaryHref: "/statistics",
      primaryLabel: "Open statistics"
    }
  ];

  if (canViewAdmin) {
    cards.push({
      title: "Manage access",
      description: "Review users and groups when you need to inspect permissions or prepare access changes.",
      primaryHref: "/admin",
      primaryLabel: "Open admin",
      secondaryHref: "/admin/users",
      secondaryLabel: "Users"
    });
  }

  return cards;
}

export default async function AppPage() {
  const requestHeaders = await headers();
  const correlationId = normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ?? undefined;
  const session = await requireServerSession();
  const [counts, canViewAdmin] = await Promise.all([
    fetchMetaCounts(session.token, correlationId),
    hasAdminAccess(session.token, correlationId)
  ]);
  const totalNamespaces = getTotalNamespaces(counts);
  const recommendedAction = getRecommendedAction(totalNamespaces, counts.total_classes, counts.total_objects);
  const actionCards = getActionCards(totalNamespaces, counts.total_classes, counts.total_objects, canViewAdmin);

  return (
    <section className="stack">
      <header className="stack action-card-header">
        <div className="stack action-card-header">
          <p className="eyebrow">Home</p>
          <h2>What do you want to do?</h2>
        </div>
        <p className="muted">Start from the task you have in mind. Statistics and database health now live separately.</p>
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
            <div className="stack action-card-header">
              <h3>{card.title}</h3>
              <p className="muted">{card.description}</p>
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
  );
}
