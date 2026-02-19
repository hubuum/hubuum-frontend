import { ObjectsExplorer } from "@/components/objects-explorer";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ObjectsPage() {
  await requireServerSession();

  return <ObjectsExplorer />;
}
