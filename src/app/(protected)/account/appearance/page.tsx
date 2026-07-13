import { AccountAppearance } from "@/components/account-appearance";
import { AccountTabs } from "@/components/account-tabs";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountAppearancePage() {
	await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Appearance</h2>
				<p className="muted">
					Personalize the workspace without changing shared data.
				</p>
			</header>
			<AccountTabs />
			<AccountAppearance />
		</section>
	);
}
