import { notFound } from "next/navigation";

import { ExportTemplateEditor } from "@/components/export-template-editor";
import { requireServerSession } from "@/lib/auth/guards";

type ExportTemplatePageProps = {
	params: Promise<{
		templateId: string;
	}>;
	searchParams: Promise<{
		test?: string;
	}>;
};

export default async function ExportTemplatePage({
	params,
	searchParams,
}: ExportTemplatePageProps) {
	await requireServerSession();
	const { templateId } = await params;
	const { test } = await searchParams;
	const parsedTemplateId = /^[1-9]\d*$/.test(templateId)
		? Number.parseInt(templateId, 10)
		: Number.NaN;

	if (!Number.isSafeInteger(parsedTemplateId) || parsedTemplateId < 1) {
		notFound();
	}

	const parsedTestTaskId =
		test && /^[1-9]\d*$/.test(test) ? Number.parseInt(test, 10) : undefined;
	const safeTestTaskId = Number.isSafeInteger(parsedTestTaskId)
		? parsedTestTaskId
		: undefined;

	return (
		<ExportTemplateEditor
			templateId={parsedTemplateId}
			initialTestTaskId={safeTestTaskId}
		/>
	);
}
