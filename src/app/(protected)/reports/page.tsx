import { ReportsWorkspace } from "@/components/reports-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ReportsPage() {
	await requireServerSession();

	return <ReportsWorkspace />;
}
