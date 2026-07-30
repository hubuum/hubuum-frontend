import { AdminUsersTable } from "@/components/admin-users-table";

export default function AdminUsersPage() {
	return (
		<section className="stack">
			<p className="muted resource-index-intro">
				Click a username to edit profile details and inspect group memberships.
			</p>
			<AdminUsersTable />
		</section>
	);
}
