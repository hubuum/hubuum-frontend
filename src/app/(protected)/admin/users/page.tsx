import { AdminUsersTable } from "@/components/admin-users-table";

export default function AdminUsersPage() {
  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Admin</p>
        <h2>Users</h2>
      </header>
      <AdminUsersTable />
    </section>
  );
}
