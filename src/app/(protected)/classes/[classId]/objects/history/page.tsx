import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ObjectNameHistoryBrowser } from "@/components/object-name-history-browser";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ObjectNameHistoryPage({
	params,
}: {
	params: Promise<{ classId: string }>;
}) {
	await requireServerSession();
	const classId = Number((await params).classId);
	if (!Number.isSafeInteger(classId) || classId < 1) notFound();
	return (
		<Suspense fallback={<p role="status">Loading history…</p>}>
			<ObjectNameHistoryBrowser classId={classId} />
		</Suspense>
	);
}
