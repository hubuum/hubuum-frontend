import { headers } from "next/headers";

import { ImportsWorkspace } from "@/components/imports-workspace";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";

export default async function ImportsPage() {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await requireServerSession();
	const canCreateNamespaces = await hasAdminAccess(session.token, correlationId);

	return <ImportsWorkspace canCreateNamespaces={canCreateNamespaces} />;
}
