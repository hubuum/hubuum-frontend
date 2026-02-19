import { AdminGroupsTable } from "@/components/admin-groups-table";

export default function AdminGroupsPage() {
  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Admin</p>
        <h2>Groups</h2>
      </header>
      <AdminGroupsTable />
    </section>
  );
}
