"use client";

import { PrincipalTokenManager } from "@/components/principal-token-manager";

export function AccountTokens() {
	return (
		<PrincipalTokenManager
			authority="self"
			listPrincipalId="me"
			targetKind="human"
		/>
	);
}
