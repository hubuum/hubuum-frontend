import { ClassesTable } from "@/components/classes-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ClassesPage() {
  await requireServerSession();

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Model</p>
        <h2>Class catalog</h2>
      </header>
      <ClassesTable />
    </section>
  );
}
