import type { Metadata } from "next";
import type { ReactNode } from "react";

import { QueryProvider } from "@/components/query-provider";
import { ConfirmProvider } from "@/lib/confirm-context";
import { ToastProvider } from "@/lib/toast-context";

import "./globals.css";

export const metadata: Metadata = {
	title: "Hubuum Console",
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

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<script src="/theme-init.js" />
				<QueryProvider>
					<ToastProvider>
						<ConfirmProvider>{children}</ConfirmProvider>
					</ToastProvider>
				</QueryProvider>
			</body>
		</html>
	);
}
