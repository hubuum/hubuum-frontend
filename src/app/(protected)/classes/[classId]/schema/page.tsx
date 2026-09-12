import { notFound } from "next/navigation";
import { ClassSchemaWorkspace } from "@/components/class-schema-workspace";
import { requireServerSession } from "@/lib/auth/guards";
import { positiveSchemaId } from "@/lib/schema-evolution";

export default async function ClassSchemaPage({
	params,
}: {
	params: Promise<{ classId: string }>;
}) {
	await requireServerSession();
	const classId = positiveSchemaId((await params).classId);
	if (classId === null) notFound();
	return <ClassSchemaWorkspace key={classId} classId={classId} />;
}
