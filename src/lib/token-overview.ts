import type {
	MeResponse,
	PrincipalTokenMetadata,
} from "@/lib/api/generated/models";

export function currentSessionToken(
	current: MeResponse | undefined,
	principalId: number | "me",
): PrincipalTokenMetadata | null {
	if (
		!current ||
		(principalId !== "me" && principalId !== current.principal.principal_id)
	) {
		return null;
	}
	// /iam/me describes the credential that successfully authenticated this request.
	return {
		...current.token,
		principal_id: current.principal.principal_id,
		active: true,
		expired: false,
		revoked_at: null,
	};
}
