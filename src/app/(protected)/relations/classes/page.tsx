import { RelationsExplorer } from "@/components/relations-explorer";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ClassRelationsPage() {
  await requireServerSession();

  return <RelationsExplorer mode="classes" />;
}
