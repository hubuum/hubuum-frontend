import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/components/login-form";
import { APPLICATION_VERSION } from "@/lib/application-version";
import { getSessionFromServerCookies } from "@/lib/auth/session";

type LoginPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
	const params = await searchParams;
	if ("username" in params || "password" in params) {
		redirect("/login");
	}

	const session = await getSessionFromServerCookies();

	if (session) {
		redirect("/app");
	}
	const errorCode = Array.isArray(params.error)
		? params.error[0]
		: params.error;
	const initialError =
		errorCode === "identity_scope_unavailable"
			? "The requested identity scope is unavailable or unsupported by this server."
			: errorCode === "session_store_unavailable"
				? "The frontend session store is unavailable. Try again shortly."
			: errorCode
				? "Login failed. Check your credentials and identity scope."
				: null;

	return (
		<main className="auth-page">
			<div className="auth-grid" aria-hidden="true" />
			<div className="gradient-orb gradient-orb--one" />
			<div className="gradient-orb gradient-orb--two" />
			<section className="auth-shell">
				<aside className="auth-story">
					<BrandMark />
					<div className="auth-story-copy">
						<p className="eyebrow">Connected knowledge</p>
						<h2>Bring your data graph into focus.</h2>
						<p>
							Model, connect, and operate on your organisation&apos;s data from
							one secure workspace.
						</p>
					</div>
					<ol className="auth-capabilities" aria-label="Hubuum capabilities">
						<li>
							<strong>01</strong> Model
						</li>
						<li>
							<strong>02</strong> Connect
						</li>
						<li>
							<strong>03</strong> Operate
						</li>
					</ol>
				</aside>

				<div className="auth-form-panel">
					<LoginForm initialError={initialError} />
					<p className="footer-note">
						{process.env.NEXT_PUBLIC_APP_NAME ?? "Hubuum Console"} ·{
							APPLICATION_VERSION
						} · Secure workspace
					</p>
				</div>
			</section>
		</main>
	);
}
