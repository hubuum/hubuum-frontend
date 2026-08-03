import type { PrincipalTokenMetadata } from "@/lib/api/generated/models";

export type TokenLifecycleStatus = "active" | "expired" | "revoked";

export function getTokenLifecycleStatus(
	token: Pick<PrincipalTokenMetadata, "expires_at" | "revoked_at">,
	now: Date = new Date(),
): TokenLifecycleStatus {
	if (token.revoked_at) {
		return "revoked";
	}

	if (token.expires_at) {
		const expiresAt = new Date(token.expires_at);
		if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now) {
			return "expired";
		}
	}

	return "active";
}

export function formatTokenLifecycleStatus(
	status: TokenLifecycleStatus,
): string {
	return status === "revoked"
		? "Revoked"
		: status === "expired"
			? "Expired"
			: "Active";
}
