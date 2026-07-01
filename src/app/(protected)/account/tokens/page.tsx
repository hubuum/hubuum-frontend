import { AccountTabs } from "@/components/account-tabs";
import { AccountTokens } from "@/components/account-tokens";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AccountTokensPage() {
	const session = await requireServerSession();

	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Account</p>
				<h2>Tokens</h2>
				<p className="muted">
					Create and revoke API tokens for your own account.
				</p>
			</header>
			<AccountTabs />
			<AccountTokens currentUsername={session.username ?? null} />
		</section>
	);
}
