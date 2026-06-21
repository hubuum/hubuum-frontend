import { AccountProfile } from "@/components/account-profile";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountPage() {
	const session = await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Profile</h2>
				<p className="muted">Manage your own Hubuum user profile.</p>
			</header>
			<AccountProfile currentUsername={session.username ?? null} />
		</section>
	);
}
