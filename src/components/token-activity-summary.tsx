"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchTokenActivity } from "@/lib/api/token-activity";

export function TokenActivitySummary({
	principalId,
	tokenId,
}: {
	principalId: number;
	tokenId: number;
}) {
	const query = useQuery({
		queryKey: ["token-activity-summary", principalId, tokenId],
		// The overview needs provenance and the total, not every retained source.
		queryFn: ({ signal }) =>
			fetchTokenActivity(principalId, tokenId, 0, signal, 1),
		staleTime: 30_000,
		gcTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
	});
	if (query.isError)
		return (
			<span className="muted">
				Activity unavailable; open details to retry.
			</span>
		);
	if (!query.data) return <span className="muted">Loading activity…</span>;
	const activity = query.data;
	const creation = activity.creation;
	return (
		<div className="token-overview-cell">
			<strong>
				{activity.session_id ? "Session token" : "Standalone token"}
			</strong>
			{creation ? (
				<>
					<span>
						{creation.issuance_method} ·{" "}
						{creation.issuer_id == null
							? "Unknown issuer"
							: `Issuer #${creation.issuer_id}`}
					</span>
					<span>
						Created from {creation.address ?? "unavailable address"} ·{" "}
						{creation.address_method.replaceAll("_", " ")}
					</span>
				</>
			) : (
				<span>Creation not recorded</span>
			)}
			<span>
				{activity.total} recorded {activity.total === 1 ? "source" : "sources"}{" "}
				· {activity.retention_days} days retained
			</span>
			{!activity.collection_enabled ? <span>Collection disabled</span> : null}
			{activity.overflow_since ? (
				<span>Source cap reached · history incomplete</span>
			) : null}
		</div>
	);
}
