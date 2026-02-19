import { RelationsExplorer } from "@/components/relations-explorer";
import { requireServerSession } from "@/lib/auth/guards";

export default async function RelationsPage() {
  await requireServerSession();

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Model</p>
        <h2>Relations</h2>
      </header>
      <RelationsExplorer />
    </section>
  );
}
