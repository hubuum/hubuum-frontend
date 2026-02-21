import { AdminGroupsTable } from "@/components/admin-groups-table";

export default function AdminGroupsPage() {
  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Admin</p>
        <h2>Groups</h2>
        <p className="muted">Click a group name to edit profile and membership assignments.</p>
      </header>
      <AdminGroupsTable />
    </section>
  );
}
