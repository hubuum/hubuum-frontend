import { AdminUsersTable } from "@/components/admin-users-table";

export default function AdminUsersPage() {
  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Admin</p>
        <h2>Users</h2>
        <p className="muted">Click a username to edit profile details and inspect group memberships.</p>
      </header>
      <AdminUsersTable />
    </section>
  );
}
