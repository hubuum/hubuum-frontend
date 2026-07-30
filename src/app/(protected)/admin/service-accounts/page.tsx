import { ServiceAccountsTable } from "@/components/service-accounts-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AdminServiceAccountsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<p className="muted resource-index-intro">
				Non-human principals for automation. Create an account and its
				least-privilege initial token in one guided flow.
			</p>
			<ServiceAccountsTable />
		</section>
	);
}
