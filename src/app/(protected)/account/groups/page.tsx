import { AccountGroups } from "@/components/account-groups";
import { AccountTabs } from "@/components/account-tabs";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountGroupsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Groups</h2>
				<p className="muted">Groups you belong to.</p>
			</header>
			<AccountTabs />
			<AccountGroups />
		</section>
	);
}
