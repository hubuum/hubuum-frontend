"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

	async function signOut() {
		setIsPending(true);

		try {
			await Promise.race([
				flushUserSettings({ keepalive: true }),
				new Promise<void>((resolve) => window.setTimeout(resolve, 750)),
			]);
			await fetch("/_hubuum-bff/auth/logout", {
				method: "POST",
				credentials: "include",
			});
		} finally {
			clearUserSettingsForLogout();
			queryClient.clear();
			router.push("/login");
			router.refresh();
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
