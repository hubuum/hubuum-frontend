import { RelationsExplorer } from "@/components/relations-explorer";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ObjectRelationsPage() {
  await requireServerSession();

  return <RelationsExplorer mode="objects" />;
}
