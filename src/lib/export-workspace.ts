import type { ReportTemplate } from "@/lib/api/reporting";

export type ExportWorkspaceView = "run" | "templates" | "history";

type TemplateFilterOptions = {
	collectionId?: number | null;
	query?: string;
};

export function filterReportTemplates(
	templates: readonly ReportTemplate[],
	options: TemplateFilterOptions = {},
): ReportTemplate[] {
	const normalizedQuery = options.query?.trim().toLocaleLowerCase() ?? "";

	return templates.filter((template) => {
		if (
			typeof options.collectionId === "number" &&
			template.collection_id !== options.collectionId
		) {
			return false;
		}

		if (!normalizedQuery) {
			return true;
		}

		return [
			template.name,
			template.description,
			template.content_type,
			template.kind,
			template.scope_kind ?? "",
		]
			.join(" ")
			.toLocaleLowerCase()
			.includes(normalizedQuery);
	});
}

export function formatExportScope(value: string | null | undefined): string {
	const labels: Record<string, string> = {
		collections: "Collections",
		classes: "Classes",
		objects_in_class: "Objects from a class",
		class_relations: "Class relations",
		object_relations: "Object relations",
		related_objects: "Objects related to one object",
	};

	return value ? (labels[value] ?? value.replaceAll("_", " ")) : "No scope";
}

export function formatExportContentType(value: string): string {
	const labels: Record<string, string> = {
		"application/json": "JSON",
		"text/plain": "Plain text",
		"text/html": "HTML",
		"text/csv": "CSV",
	};

	return labels[value] ?? value;
}
