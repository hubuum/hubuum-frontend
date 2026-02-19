import { NamespacesTable } from "@/components/namespaces-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function NamespacesPage() {
  await requireServerSession();

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Model</p>
        <h2>Namespaces</h2>
      </header>
      <NamespacesTable />
    </section>
  );
}
