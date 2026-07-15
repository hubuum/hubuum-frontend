import { ExportsWorkspace } from "@/components/exports-workspace";
import { requireServerSession } from "@/lib/auth/guards";
import type { ExportWorkspaceView } from "@/lib/export-workspace";

type ExportsPageProps = {
	searchParams: Promise<{
		view?: string;
	}>;
};

export default async function ExportsPage({ searchParams }: ExportsPageProps) {
	await requireServerSession();
	const { view } = await searchParams;
	const initialView: ExportWorkspaceView =
		view === "templates" || view === "history" ? view : "run";

	return <ExportsWorkspace initialView={initialView} />;
}
