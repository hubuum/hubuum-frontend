import { AccountTabs } from "@/components/account-tabs";
import { ServiceAccountsTable } from "@/components/service-accounts-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountServiceAccountsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Service accounts</h2>
				<p className="muted">
					Manage service accounts owned by one of your groups and mint their
					automation tokens.
				</p>
			</header>
			<AccountTabs />
			<ServiceAccountsTable
				allowCreate={false}
				detailBasePath="/account/service-accounts"
			/>
		</section>
	);
}
