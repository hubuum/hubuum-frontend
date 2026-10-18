import { notFound } from "next/navigation";
import { NeighborhoodGraph } from "@/components/neighborhood-graph";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ClassGraphPage({
	params,
}: {
	params: Promise<{ classId: string }>;
}) {
	await requireServerSession();
	const classId = Number((await params).classId);
	if (!Number.isSafeInteger(classId) || classId < 1) notFound();
	return <NeighborhoodGraph key={classId} scope={{ type: "class", classId }} />;
}
