import { notFound } from "next/navigation";

import { ClassDetail } from "@/components/class-detail";
import { requireServerSession } from "@/lib/auth/guards";

type ClassDetailPageProps = {
  params: Promise<{
    classId: string;
  }>;
};

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export default async function ClassDetailPage({ params }: ClassDetailPageProps) {
  await requireServerSession();
  const { classId } = await params;
  const parsedClassId = parseId(classId);

  if (parsedClassId === null) {
    notFound();
  }

  return (
    <section className="stack">
      <ClassDetail classId={parsedClassId} />
    </section>
  );
}
