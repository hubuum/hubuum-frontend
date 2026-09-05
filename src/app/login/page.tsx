import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { LoginBackgroundPicker } from "@/components/login-background-picker";
import { LoginForm } from "@/components/login-form";
import { APPLICATION_VERSION } from "@/lib/application-version";
import { getSessionFromServerCookies } from "@/lib/auth/session";
import { listMountedLoginBackgrounds } from "@/lib/login-backgrounds";
import { normalizeReturnPath } from "@/lib/return-path";
import { SESSION_EXPIRED_ERROR_CODE } from "@/lib/session-expiry";

type LoginPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
	title: "Sign in",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
	const params = await searchParams;
	if ("username" in params || "password" in params) {
		redirect("/login");
	}
	const requestedReturnPath = Array.isArray(params.next)
		? params.next[0]
		: params.next;
	const returnTo = normalizeReturnPath(requestedReturnPath);

	const session = await getSessionFromServerCookies();

	if (session) {
		redirect(returnTo);
	}
	const mountedBackgrounds = await listMountedLoginBackgrounds();
	const errorCode = Array.isArray(params.error)
		? params.error[0]
		: params.error;
	const initialError =
		errorCode === SESSION_EXPIRED_ERROR_CODE
			? "Your session has expired. Sign in again to continue."
			: errorCode === "identity_scope_unavailable"
				? "The requested identity scope is unavailable or unsupported by this server."
				: errorCode === "session_store_unavailable"
					? "The frontend session store is unavailable. Try again shortly."
					: errorCode
						? "Login failed. Check your credentials and identity scope."
						: null;

	return (
		<main className="auth-page">
			<div className="auth-background" aria-hidden="true" />
			<header className="auth-masthead">
				<BrandMark />
			</header>

			<section className="auth-shell" aria-label="Workspace sign in">
				<div className="auth-form-panel">
					<h1 className="login-heading">Sign in to Hubuum</h1>
					<LoginForm initialError={initialError} returnTo={returnTo} />
					<p className="footer-note">
						{process.env.NEXT_PUBLIC_APP_NAME ?? "Hubuum Console"} ·
						{APPLICATION_VERSION}
					</p>
				</div>
			</section>

			<LoginBackgroundPicker mountedBackgrounds={mountedBackgrounds} />
		</main>
	);
}
