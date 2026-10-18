"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revokeUserTokens } from "@/lib/api/admin-security";
import { endBrowserSession } from "@/lib/logout";
import {
	clearUserSettingsForLogout,
	flushUserSettings,
} from "@/lib/user-settings-client";
import { useConfirm } from "@/lib/confirm-context";
export function RevokeUserTokens({
	userId,
	self,
}: {
	userId: number;
	self: boolean;
}) {
	const confirm = useConfirm();
	const client = useQueryClient();
	const mutation = useMutation({
		mutationFn: async () => {
			if (self) {
				await endBrowserSession(
					() => flushUserSettings({ keepalive: true }),
					true,
				);
			} else await revokeUserTokens(userId);
		},
		onSuccess: async () => {
			if (self) {
				try {
					clearUserSettingsForLogout();
				} catch {
					/* Storage can be unavailable. */
				}
				client.clear();
				window.location.assign("/login");
				return;
			}
			await client.invalidateQueries({
				queryKey: ["principal-tokens", userId],
			});
		},
	});
	async function revoke() {
		if (mutation.isPending) return;
		if (
			await confirm({
				title: self
					? "Revoke all your tokens?"
					: `Revoke all tokens for user #${userId}?`,
				description: self
					? "This signs you out on every device and invalidates all your API tokens, including this session."
					: "This signs the user out on every device and invalidates all their API tokens.",
				confirmLabel: "Revoke all tokens",
				tone: "danger",
			})
		)
			mutation.mutate();
	}
	return (
		<div className="stack">
			<div>
				<button
					type="button"
					className="danger"
					aria-disabled={mutation.isPending}
					onClick={() => void revoke()}
				>
					Revoke all tokens
				</button>
			</div>
			{mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
			{mutation.isSuccess && !self ? (
				<p role="status">All tokens for this user have been revoked.</p>
			) : null}
		</div>
	);
}
