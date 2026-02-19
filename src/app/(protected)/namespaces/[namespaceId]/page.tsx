import { notFound } from "next/navigation";

import { NamespaceDetail } from "@/components/namespace-detail";
import { requireServerSession } from "@/lib/auth/guards";

type NamespaceDetailPageProps = {
  params: Promise<{
    namespaceId: string;
  }>;
};

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export default async function NamespaceDetailPage({ params }: NamespaceDetailPageProps) {
  await requireServerSession();
  const { namespaceId } = await params;
  const parsedNamespaceId = parseId(namespaceId);

  if (parsedNamespaceId === null) {
    notFound();
  }

  return (
    <section className="stack">
      <NamespaceDetail namespaceId={parsedNamespaceId} />
    </section>
  );
}
