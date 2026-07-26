import { ExportTemplateEditor } from "@/components/export-template-editor";
import { requireServerSession } from "@/lib/auth/guards";

type NewExportTemplatePageProps = {
	searchParams: Promise<{
		from?: string;
	}>;
};

export default async function NewExportTemplatePage({
	searchParams,
}: NewExportTemplatePageProps) {
	await requireServerSession();
	const { from } = await searchParams;
	const parsedDuplicateTemplateId =
		from && /^[1-9]\d*$/.test(from) ? Number.parseInt(from, 10) : undefined;
	const duplicateTemplateId = Number.isSafeInteger(parsedDuplicateTemplateId)
		? parsedDuplicateTemplateId
		: undefined;

	return <ExportTemplateEditor duplicateTemplateId={duplicateTemplateId} />;
}
