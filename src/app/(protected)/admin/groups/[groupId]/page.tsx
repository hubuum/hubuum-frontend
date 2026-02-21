import { notFound } from "next/navigation";

import { AdminGroupDetail } from "@/components/admin-group-detail";
import { requireServerSession } from "@/lib/auth/guards";

type AdminGroupDetailPageProps = {
  params: Promise<{
    groupId: string;
  }>;
};

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export default async function AdminGroupDetailPage({ params }: AdminGroupDetailPageProps) {
  await requireServerSession();
  const { groupId } = await params;
  const parsedGroupId = parseId(groupId);

  if (parsedGroupId === null) {
    notFound();
  }

  return (
    <section className="stack">
      <AdminGroupDetail groupId={parsedGroupId} />
    </section>
  );
}
