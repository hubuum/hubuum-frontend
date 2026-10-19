import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ClassQueryUsageWorkspace } from "@/components/class-query-usage-workspace";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";

export default async function ClassQueryUsagePage({
	params,
}: {
	params: Promise<{ classId: string }>;
}) {
	const session = await requireServerSession();
	const rawId = (await params).classId;
	const classId = Number(rawId);
	if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(classId) || classId < 1)
		notFound();
	const correlationId =
		normalizeCorrelationId((await headers()).get(CORRELATION_ID_HEADER)) ??
		undefined;
	const canAnalyze = await hasAdminAccess(session.token, correlationId);
	return (
		<ClassQueryUsageWorkspace
			key={classId}
			classId={classId}
			canAnalyze={canAnalyze}
		/>
	);
}
