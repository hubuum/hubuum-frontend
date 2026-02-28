import { notFound } from "next/navigation";

import { AdminUserDetail } from "@/components/admin-user-detail";
import { requireServerSession } from "@/lib/auth/guards";

type AdminUserDetailPageProps = {
  params: Promise<{
    userId: string;
  }>;
};

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  await requireServerSession();
  const { userId } = await params;
  const parsedUserId = parseId(userId);

  if (parsedUserId === null) {
    notFound();
  }

  return (
    <section className="stack">
      <AdminUserDetail userId={parsedUserId} />
    </section>
  );
}
