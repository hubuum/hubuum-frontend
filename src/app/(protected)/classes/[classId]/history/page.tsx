import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ResourceHistoryBrowser } from "@/components/resource-history-browser";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ClassHistoryPage({
	params,
}: {
	params: Promise<{ classId: string }>;
}) {
	await requireServerSession();
	const classId = Number((await params).classId);
	if (!Number.isSafeInteger(classId) || classId < 1) notFound();
	return (
		<Suspense fallback={<p role="status">Loading history…</p>}>
			<ResourceHistoryBrowser
				key={classId}
				scope={{ type: "class", classId }}
			/>
		</Suspense>
	);
}
