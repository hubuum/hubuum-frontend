import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { QueryProvider } from "@/components/query-provider";
import { ConfirmProvider } from "@/lib/confirm-context";
import { CSP_NONCE_HEADER } from "@/lib/security-policy";
import { ToastProvider } from "@/lib/toast-context";

import "@fontsource-variable/fraunces";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import "./stillwater.css";
import "./workspace-controls.css";

export const metadata: Metadata = {
	title: {
		default: "Hubuum Console",
		template: "%s · Hubuum",
	},
	description: "Frontend console for the Hubuum REST application.",
	icons: {
		icon: [
			{ url: "/favicon.ico", sizes: "32x32" },
			{ url: "/icon.svg", type: "image/svg+xml" },
		],
		apple: [
			{
				url: "/apple-touch-icon.png",
				sizes: "180x180",
				type: "image/png",
			},
		],
	},
};

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;
	return (
		<html lang="en" data-design-variant="v6" suppressHydrationWarning>
			<body>
				<script src="/theme-init.js" nonce={nonce} />
				<QueryProvider>
					<ToastProvider>
						<ConfirmProvider>{children}</ConfirmProvider>
					</ToastProvider>
				</QueryProvider>
			</body>
		</html>
	);
}
