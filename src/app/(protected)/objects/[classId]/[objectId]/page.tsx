import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ObjectDetail } from "@/components/object-detail";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/lib/correlation";

type ObjectDetailPageProps = {
  params: Promise<{
    classId: string;
    objectId: string;
  }>;
};

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export default async function ObjectDetailPage({ params }: ObjectDetailPageProps) {
  const requestHeaders = await headers();
  const correlationId = normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ?? undefined;
  const session = await requireServerSession();
  const canEditAnything = await hasAdminAccess(session.token, correlationId);
  const { classId, objectId } = await params;
  const parsedClassId = parseId(classId);
  const parsedObjectId = parseId(objectId);

  if (parsedClassId === null || parsedObjectId === null) {
    notFound();
  }

  return (
    <section className="stack">
      <ObjectDetail
        classId={parsedClassId}
        objectId={parsedObjectId}
        currentUsername={session.username ?? null}
        canEditAnything={canEditAnything}
      />
    </section>
  );
}
