import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ResourceHistoryBrowser } from "@/components/resource-history-browser";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ObjectHistoryPage({
	params,
}: {
	params: Promise<{ classId: string; objectId: string }>;
}) {
	await requireServerSession();
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
	return (
		<Suspense fallback={<p role="status">Loading history…</p>}>
			<ResourceHistoryBrowser
				key={`${classId}:${objectId}`}
				scope={{ type: "object", classId, objectId }}
			/>
		</Suspense>
	);
}
