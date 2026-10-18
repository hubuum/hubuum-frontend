import { AdminPrincipalSettings } from "@/components/admin-principal-settings";
import { EffectiveAccessInspector } from "@/components/effective-access-inspector";
import { LoginRateLimits } from "@/components/login-rate-limits";
import { requireServerSession } from "@/lib/auth/guards";
export default async function AdminSecurityPage() {
	await requireServerSession();
	return (
		<section className="stack">
			<header>
				<h2>Security</h2>
				<p className="muted">
					Inspect login protection, principal preferences, and inherited access.
				</p>
			</header>
			<LoginRateLimits />
			<AdminPrincipalSettings />
			<EffectiveAccessInspector />
		</section>
	);
}
