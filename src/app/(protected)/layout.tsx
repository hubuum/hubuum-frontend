import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { UserSettingsSync } from "@/components/user-settings-sync";
import { hasAdminAccess } from "@/lib/auth/admin";
import { getCurrentPrincipalId } from "@/lib/auth/current-principal";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { loadUserSettingsSnapshotForPrincipal } from "@/lib/user-settings-server";

export default async function ProtectedLayout({
	children,
}: {
	children: ReactNode;
}) {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await requireServerSession();
	const [canViewAdmin, principalId] = await Promise.all([
		hasAdminAccess(session.token, correlationId),
		getCurrentPrincipalId(session.token, correlationId).catch(() => null),
	]);
	const initialSettings = principalId
		? await loadUserSettingsSnapshotForPrincipal({
				principalId,
				token: session.token,
				correlationId,
			}).catch(() => null)
		: null;

	return (
		<UserSettingsSync
			principalId={principalId}
			initialSnapshot={initialSettings}
		>
			<AppShell
				canViewAdmin={canViewAdmin}
				currentPrincipalId={principalId}
				currentUsername={session.username ?? null}
			>
				{children}
			</AppShell>
		</UserSettingsSync>
	);
}
