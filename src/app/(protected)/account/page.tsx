import { AccountProfile } from "@/components/account-profile";
import { AccountTabs } from "@/components/account-tabs";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountPage() {
	const session = await requireServerSession();

	return (
		<section className="stack">
			<header>
				<h2>Profile</h2>
				<p className="muted">Manage your own Hubuum user profile.</p>
			</header>
			<AccountTabs />
			<AccountProfile currentUsername={session.username ?? null} />
		</section>
	);
}
