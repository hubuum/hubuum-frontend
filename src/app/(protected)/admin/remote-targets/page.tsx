import { AdminRemoteTargetsTable } from "@/components/admin-remote-targets-table";

export default function AdminRemoteTargetsPage() {
	return (
		<section className="stack">
			<p className="muted resource-index-intro">
				Manage collection-scoped outbound actions that users can invoke from
				entity pages.
			</p>
			<AdminRemoteTargetsTable />
		</section>
	);
}
