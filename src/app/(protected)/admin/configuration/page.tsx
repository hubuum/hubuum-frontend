import { headers } from "next/headers";

import { RuntimeConfigPanel } from "@/components/runtime-config-panel";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { tryFetchRunningConfig } from "@/lib/meta";

export default async function AdminConfigurationPage() {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await requireServerSession();
	const config = await tryFetchRunningConfig(session.token, correlationId);

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Admin</p>
					<h2>Runtime configuration</h2>
				</div>
				<p className="muted">
					Read-only effective server settings. Secrets and sensitive values are
					redacted by Hubuum Server.
				</p>
			</header>

			{config ? (
				<RuntimeConfigPanel config={config} />
			) : (
				<div className="error-banner" role="alert">
					Runtime configuration is unavailable from this server.
				</div>
			)}
		</section>
	);
}
