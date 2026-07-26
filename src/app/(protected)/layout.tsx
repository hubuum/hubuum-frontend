import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { UserSettingsSync } from "@/components/user-settings-sync";
import { requireServerSession } from "@/lib/auth/guards";
import { loadProtectedLayoutBootstrap } from "@/lib/auth/protected-layout-bootstrap";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";

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
	const { canViewAdmin, initialSettings, principalId } =
		await loadProtectedLayoutBootstrap({
			correlationId,
			sid: session.sid,
			token: session.token,
		});

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
