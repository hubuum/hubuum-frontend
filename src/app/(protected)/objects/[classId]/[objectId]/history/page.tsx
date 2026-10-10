import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ResourceHistoryBrowser } from "@/components/resource-history-browser";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";

export default async function ObjectHistoryPage({
	params,
}: {
	params: Promise<{ classId: string; objectId: string }>;
}) {
	const session = await requireServerSession();
	const ids = await params;
	const classId = Number(ids.classId);
	const objectId = Number(ids.objectId);
	if (
		!Number.isSafeInteger(classId) ||
		classId < 1 ||
		!Number.isSafeInteger(objectId) ||
		objectId < 1
	)
		notFound();
	const correlationId =
		normalizeCorrelationId((await headers()).get(CORRELATION_ID_HEADER)) ??
		undefined;
	const isAdmin = await hasAdminAccess(session.token, correlationId);
	return (
		<Suspense fallback={<p role="status">Loading history…</p>}>
			<ResourceHistoryBrowser
				key={`${classId}:${objectId}`}
				scope={{ type: "object", classId, objectId }}
				isAdmin={isAdmin}
			/>
		</Suspense>
	);
}
