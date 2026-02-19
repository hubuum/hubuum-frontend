import { ClassesTable } from "@/components/classes-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ClassesPage() {
  await requireServerSession();

  return <ClassesTable />;
}
