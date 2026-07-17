import type {
	ReportMissingDataPolicy,
	ReportScopeKind,
	ReportTemplateKind,
	StoredReportContentType,
} from "@/lib/api/reporting";
import {
	buildIncludeFromRows,
	type IncludeBuilderRow,
} from "@/lib/report-include";
import { analyzeTemplate } from "@/lib/template-suggestions";

export type ExportTemplateDraft = {
	mode: "create" | "edit";
	templateId: number | null;
	collectionId: string;
	name: string;
	description: string;
	contentType: StoredReportContentType;
	templateBody: string;
	kind: ReportTemplateKind;
	scopeKind: ReportScopeKind;
	classId: string;
	defaultQuery: string;
	includeRows: IncludeBuilderRow[];
	depth: string;
	missingDataPolicy: ReportMissingDataPolicy;
	maxItems: string;
	maxOutputBytes: string;
};

export type ExportTemplateDraftField =
	| "collectionId"
	| "name"
	| "description"
	| "templateBody"
	| "classId"
	| "depth"
	| "maxItems"
	| "maxOutputBytes"
	| "includeRows";

export type ExportTemplateDraftErrors = Partial<
	Record<ExportTemplateDraftField, string>
>;

export type ExportTemplateEditorSection =
	| "target"
	| "filters"
	| "related"
	| "rules"
	| "appearance"
	| "history";

export type ExportTemplateValidationContext = {
	classCollectionById?: ReadonlyMap<number, number>;
};

export function parsePositiveInteger(value: string): number | null {
	if (!/^[1-9]\d*$/.test(value.trim())) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

export function validateExportTemplateTarget(
	draft: ExportTemplateDraft,
	context: ExportTemplateValidationContext = {},
): ExportTemplateDraftErrors {
	const errors: ExportTemplateDraftErrors = {};
	const collectionId = parsePositiveInteger(draft.collectionId);
	if (!collectionId) {
		errors.collectionId = "Choose a collection.";
	}

	if (draft.kind === "export") {
		const scopeNeedsClass =
			draft.scopeKind === "objects_in_class" ||
			draft.scopeKind === "related_objects";
		const classId = parsePositiveInteger(draft.classId);
		if (scopeNeedsClass && !classId) {
			errors.classId = "Choose a class from the selected collection.";
		} else if (
			scopeNeedsClass &&
			classId &&
			collectionId &&
			context.classCollectionById?.has(classId) &&
			context.classCollectionById.get(classId) !== collectionId
		) {
			errors.classId =
				"Choose a class that belongs to the selected collection.";
		}
	}

	return errors;
}

export function validateExportTemplateRelated(
	draft: ExportTemplateDraft,
): ExportTemplateDraftErrors {
	const errors: ExportTemplateDraftErrors = {};
	if (draft.kind !== "export") return errors;
	const scopeNeedsClass =
		draft.scopeKind === "objects_in_class" ||
		draft.scopeKind === "related_objects";
	if (draft.depth.trim()) {
		const depth = parsePositiveInteger(draft.depth);
		if (!depth || depth > 2) {
			errors.depth = "Use a relation depth of 1 or 2.";
		}
	}
	if (scopeNeedsClass) {
		const include = buildIncludeFromRows(draft.includeRows);
		if ("error" in include) errors.includeRows = include.error;
	}
	return errors;
}

export function validateExportTemplateRules(
	draft: ExportTemplateDraft,
): ExportTemplateDraftErrors {
	const errors: ExportTemplateDraftErrors = {};
	if (draft.kind !== "export") return errors;
	if (draft.maxItems.trim() && !parsePositiveInteger(draft.maxItems)) {
		errors.maxItems = "Maximum items must be a positive whole number.";
	}
	if (
		draft.maxOutputBytes.trim() &&
		!parsePositiveInteger(draft.maxOutputBytes)
	) {
		errors.maxOutputBytes =
			"Maximum output size must be a positive whole number.";
	}
	return errors;
}

export function validateExportTemplateDraft(
	draft: ExportTemplateDraft,
	context: ExportTemplateValidationContext = {},
): ExportTemplateDraftErrors {
	const errors = {
		...validateExportTemplateTarget(draft, context),
		...validateExportTemplateRelated(draft),
		...validateExportTemplateRules(draft),
	};
	if (!draft.name.trim()) errors.name = "Enter a template name.";
	if (!draft.description.trim()) {
		errors.description = "Describe when this template should be used.";
	}
	if (!draft.templateBody.trim()) {
		errors.templateBody = "Add template content.";
	} else {
		const analysis = analyzeTemplate(draft.templateBody);
		if (analysis.openEach !== analysis.closeEach) {
			errors.templateBody =
				"Balance every {% for %} with a matching {% endfor %}.";
		}
	}
	return errors;
}

export function filterClassesForCollection<
	T extends { collection: { id: number } },
>(classes: readonly T[], collectionId: string): T[] {
	const parsedCollectionId = parsePositiveInteger(collectionId);
	return parsedCollectionId
		? classes.filter((item) => item.collection.id === parsedCollectionId)
		: [];
}

export function getEditorTabForErrors(
	errors: ExportTemplateDraftErrors,
): ExportTemplateEditorSection {
	if (errors.collectionId || errors.classId) return "target";
	if (errors.includeRows || errors.depth) return "related";
	if (errors.maxItems || errors.maxOutputBytes) return "rules";
	return "appearance";
}
