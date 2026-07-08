import { ExportsWorkspace } from "@/components/exports-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ExportsPage() {
	await requireServerSession();

	return <ExportsWorkspace />;
}
