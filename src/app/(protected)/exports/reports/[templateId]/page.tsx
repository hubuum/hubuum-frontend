import { notFound } from "next/navigation";

import { ReportConfigurator } from "@/components/report-configurator";
import { requireServerSession } from "@/lib/auth/guards";
import type { ReportConfiguratorValues } from "@/lib/report-configuration";

type ReportConfigurationPageProps = {
	params: Promise<{
		templateId: string;
	}>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(
	value: string | string[] | undefined,
	fallback = "",
): string {
	if (Array.isArray(value)) {
		return value[0] ?? fallback;
	}
	return value ?? fallback;
}

export default async function ReportConfigurationPage({
	params,
	searchParams,
}: ReportConfigurationPageProps) {
	await requireServerSession();
	const { templateId } = await params;
	const parsedTemplateId = /^[1-9]\d*$/.test(templateId)
		? Number.parseInt(templateId, 10)
		: Number.NaN;
	if (!Number.isSafeInteger(parsedTemplateId) || parsedTemplateId < 1) {
		notFound();
	}

	const query = await searchParams;
	const policy = firstValue(query.missing_data_policy);
	const initialValues: ReportConfiguratorValues = {
		maxAge: firstValue(query.max_age),
		maxItems: firstValue(query.max_items),
		maxOutputBytes: firstValue(query.max_output_bytes),
		missingDataPolicy:
			policy === "strict" || policy === "null" || policy === "omit"
				? policy
				: "",
		objectId: firstValue(query.object_id),
		query: firstValue(query.query),
	};

	return (
		<ReportConfigurator
			initialQueryOverride={query.query !== undefined}
			initialValues={initialValues}
			templateId={parsedTemplateId}
		/>
	);
}
