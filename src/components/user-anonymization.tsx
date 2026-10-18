"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { anonymizeUser, fetchUserRevision } from "@/lib/api/admin-security";
import { useConfirm } from "@/lib/confirm-context";
import { endBrowserSession } from "@/lib/logout";
import { useCurrentPrincipal } from "@/lib/use-current-principal";
export function UserAnonymization({
	userId,
	onAnonymized,
}: {
	userId: number;
	onAnonymized: () => void;
}) {
	const client = useQueryClient();
	const confirm = useConfirm();
	const current = useCurrentPrincipal();
	const query = useQuery({
		queryKey: ["user-anonymization", userId],
		queryFn: () => fetchUserRevision(userId),
	});
	const mutation = useMutation({
		mutationFn: async () => {
			if (!query.data?.etag)
				throw new Error("Reload the user revision before anonymizing.");
			await anonymizeUser(userId, query.data.etag);
		},
		onSuccess: async () => {
			if (current.data?.principal.principal_id === userId) {
				await endBrowserSession(async () => undefined);
				window.location.assign("/login");
				return;
			}
			await Promise.all([
				client.invalidateQueries({ queryKey: ["admin-user", userId] }),
				client.invalidateQueries({ queryKey: ["admin-users"] }),
				client.invalidateQueries({ queryKey: ["user-anonymization", userId] }),
				client.invalidateQueries({ queryKey: ["principal-tokens", userId] }),
			]);
			onAnonymized();
		},
	});
	async function anonymize() {
		if (mutation.isPending) return;
		if (
			await confirm({
				title: `Anonymize user #${userId}?`,
				description: `Permanently remove personal information from ${query.data?.user.name ?? "this user"}, disable login, and revoke their tokens. Existing audit references remain. This cannot be undone.`,
				confirmLabel: "Anonymize user",
				tone: "danger",
			})
		)
			mutation.mutate();
	}
	return (
		<section className="card stack" aria-label="User anonymization">
			<h3>Anonymize user</h3>
			<p>
				Remove personal information while retaining the principal for historical
				references.
			</p>
			<div className="action-row">
				<button
					type="button"
					className="danger"
					disabled={!query.data?.etag || query.isFetching || !current.data}
					aria-disabled={mutation.isPending}
					onClick={() => void anonymize()}
				>
					Anonymize user
				</button>
				<button
					type="button"
					className="secondary"
					disabled={query.isFetching || mutation.isPending}
					onClick={() => void query.refetch()}
				>
					Reload user revision
				</button>
			</div>
			{query.isError ? <p role="alert">{query.error.message}</p> : null}
			{mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
			{mutation.isSuccess ? <p role="status">User anonymized.</p> : null}
		</section>
	);
}
