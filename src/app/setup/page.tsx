import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BackendSetupForm } from "@/components/backend-setup-form";
import { BrandMark } from "@/components/brand-mark";
import { LoginBackgroundPicker } from "@/components/login-background-picker";
import { APPLICATION_VERSION } from "@/lib/application-version";
import { getBackendSetupStatus } from "@/lib/backend-target";
import { listMountedLoginBackgrounds } from "@/lib/login-backgrounds";

export const metadata: Metadata = { title: "Connect your server" };

export default async function SetupPage() {
	const status = await getBackendSetupStatus();
	if (status === "configured") redirect("/login");
	const mountedBackgrounds = await listMountedLoginBackgrounds();
	return (
		<main className="auth-page">
			<div className="auth-background" aria-hidden="true" />
			<header className="auth-masthead">
				<BrandMark />
			</header>
			<section className="auth-shell" aria-label="Installation setup">
				<div className="auth-form-panel">
					<h1 className="login-heading">Connect your server</h1>
					{status === "available" ? (
						<BackendSetupForm />
					) : (
						<div className="login-card card" role="status">
							<p>
								Setup is temporarily unavailable. Ask the installation operator
								to check the frontend configuration and Valkey connection, then
								reload this page.
							</p>
						</div>
					)}
					<p className="footer-note">
						{process.env.NEXT_PUBLIC_APP_NAME ?? "Hubuum Console"} ·{" "}
						{APPLICATION_VERSION}
					</p>
				</div>
			</section>
			<LoginBackgroundPicker mountedBackgrounds={mountedBackgrounds} />
		</main>
	);
}
