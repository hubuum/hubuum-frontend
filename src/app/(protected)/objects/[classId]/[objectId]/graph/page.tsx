import { notFound } from "next/navigation";
import { NeighborhoodGraph } from "@/components/neighborhood-graph";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ObjectGraphPage({
	params,
}: {
	params: Promise<{ classId: string; objectId: string }>;
}) {
	await requireServerSession();
	const ids = await params;
	const classId = Number(ids.classId),
		objectId = Number(ids.objectId);
	if (
		!Number.isSafeInteger(classId) ||
		classId < 1 ||
		!Number.isSafeInteger(objectId) ||
		objectId < 1
	)
		notFound();
	return (
		<NeighborhoodGraph
			key={`${classId}:${objectId}`}
			scope={{ type: "object", classId, objectId }}
		/>
	);
}
