import { AccountTabs } from "@/components/account-tabs";
import { PrincipalPermissions } from "@/components/principal-permissions";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountPermissionsPage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Permissions</h2>
				<p className="muted">
					Your effective permissions across collections, by granting group.
				</p>
			</header>
			<AccountTabs />
			<PrincipalPermissions principalId="me" />
		</section>
	);
}
