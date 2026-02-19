import { NamespacesTable } from "@/components/namespaces-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function NamespacesPage() {
  await requireServerSession();

  return <NamespacesTable />;
}
