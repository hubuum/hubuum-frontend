export type TokenMintAuthority =
	| "self"
	| "admin"
	| "service_account_manager";

export type TokenMintAccessInput = {
	actorKind: string | null | undefined;
	actorPrincipalId: number | null | undefined;
	authority: TokenMintAuthority;
	currentTokenScoped: boolean;
	targetDisabled?: boolean;
	targetKind: "human" | "service_account";
	targetPrincipalId: number | null | undefined;
};

export type TokenMintAccess = {
	allowed: boolean;
	reason: string | null;
};

function isHumanPrincipal(kind: string | null | undefined): boolean {
	return kind === "user" || kind === "human";
}

export function getTokenMintAccess({
	actorKind,
	actorPrincipalId,
	authority,
	currentTokenScoped,
	targetDisabled = false,
	targetKind,
	targetPrincipalId,
}: TokenMintAccessInput): TokenMintAccess {
	if (!isHumanPrincipal(actorKind)) {
		return {
			allowed: false,
			reason:
				actorKind === "service_account"
					? "Service accounts cannot mint tokens."
					: "Only human users can mint tokens.",
		};
	}

	if (targetKind === "service_account" && targetDisabled) {
		return {
			allowed: false,
			reason: "Disabled service accounts cannot receive new tokens.",
		};
	}

	if (authority === "self") {
		if (
			targetKind !== "human" ||
			actorPrincipalId == null ||
			targetPrincipalId == null ||
			actorPrincipalId !== targetPrincipalId
		) {
			return {
				allowed: false,
				reason:
					"Self-service token creation is limited to your own human account.",
			};
		}
		if (currentTokenScoped) {
			return {
				allowed: false,
				reason:
					"Self-service token creation requires an unscoped session token.",
			};
		}
		return { allowed: true, reason: null };
	}

	if (
		authority === "service_account_manager" &&
		targetKind !== "service_account"
	) {
		return {
			allowed: false,
			reason: "This management flow only mints service-account tokens.",
		};
	}

	return { allowed: true, reason: null };
}
