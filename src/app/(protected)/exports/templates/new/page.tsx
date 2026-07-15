import { ExportTemplateEditor } from "@/components/export-template-editor";
import { requireServerSession } from "@/lib/auth/guards";

export default async function NewExportTemplatePage() {
	await requireServerSession();

	return <ExportTemplateEditor />;
}
