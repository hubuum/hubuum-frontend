"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { endBrowserSession } from "@/lib/logout";
import { useToast } from "@/lib/toast-context";

import {
	clearUserSettingsForLogout,
	flushUserSettings,
} from "@/lib/user-settings-client";

type LogoutButtonProps = {
	className?: string;
	label?: string;
};

export function LogoutButton({
	className,
	label = "Sign out",
}: LogoutButtonProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [isPending, setIsPending] = useState(false);
	const { showToast } = useToast();

	async function signOut() {
		setIsPending(true);

		try {
			await endBrowserSession(() => flushUserSettings({ keepalive: true }));
			try {
				clearUserSettingsForLogout();
			} catch {
				// Browser storage may be unavailable; the server session has ended.
			}
			queryClient.clear();
			router.push("/login");
			router.refresh();
		} catch {
			showToast(
				"Sign-out could not be completed. You may still be signed in. Please try Sign out again.",
				"error",
			);
		} finally {
			setIsPending(false);
		}
	}

	return (
		<button
			className={className ?? "ghost"}
			type="button"
			onClick={signOut}
			disabled={isPending}
		>
			{isPending ? "Signing out..." : label}
		</button>
	);
}
