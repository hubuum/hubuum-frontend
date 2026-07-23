import { ServiceAccountsTable } from "@/components/service-accounts-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AdminServiceAccountsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Admin</p>
				<h2>Service accounts</h2>
				<p className="muted">
					Non-human principals for automation. Create an account and its
					least-privilege initial token in one guided flow.
				</p>
			</header>
			<ServiceAccountsTable />
		</section>
	);
}
