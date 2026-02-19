import { ObjectsExplorer } from "@/components/objects-explorer";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ObjectsPage() {
  await requireServerSession();

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Model</p>
        <h2>Objects</h2>
      </header>
      <ObjectsExplorer />
    </section>
  );
}
