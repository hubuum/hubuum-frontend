import { notFound } from "next/navigation";

import { ObjectDetail } from "@/components/object-detail";
import { requireServerSession } from "@/lib/auth/guards";

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
  await requireServerSession();
  const { classId, objectId } = await params;
  const parsedClassId = parseId(classId);
  const parsedObjectId = parseId(objectId);

  if (parsedClassId === null || parsedObjectId === null) {
    notFound();
  }

  return (
    <section className="stack">
      <ObjectDetail classId={parsedClassId} objectId={parsedObjectId} />
    </section>
  );
}
