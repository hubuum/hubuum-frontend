import { AdminGroupsTable } from "@/components/admin-groups-table";

export default function AdminGroupsPage() {
	return (
		<section className="stack">
			<p className="muted resource-index-intro">
				Click a group name to edit profile and membership assignments.
			</p>
			<AdminGroupsTable />
		</section>
	);
}
