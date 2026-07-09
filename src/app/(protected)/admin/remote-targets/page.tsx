import { AdminRemoteTargetsTable } from "@/components/admin-remote-targets-table";

export default function AdminRemoteTargetsPage() {
	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Admin</p>
				<h2>Remote targets</h2>
				<p className="muted">
					Manage collection-scoped outbound actions that users can invoke from
					entity pages.
				</p>
			</header>
			<AdminRemoteTargetsTable />
		</section>
	);
}
