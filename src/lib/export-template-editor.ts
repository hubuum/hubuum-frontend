import type {
	NewReportTemplate,
	ReportMissingDataPolicy,
	ReportScopeKind,
	ReportTemplate,
	ReportTemplateKind,
	StoredReportContentType,
	UpdateReportTemplate,
} from "@/lib/api/reporting";
import {
	buildIncludeFromRows,
	type IncludeBuilderRow,
	includeRowsFromTemplate,
} from "@/lib/report-include";
import { parsePositiveInteger } from "@/lib/number-input";
import { analyzeTemplate } from "@/lib/template-suggestions";

export { parsePositiveInteger } from "@/lib/number-input";

export type HtmlDocumentMode = "standard" | "full";

export type ExportTemplateDraft = {
	mode: "create" | "edit";
	templateId: number | null;
	collectionId: string;
	name: string;
	description: string;
	contentType: StoredReportContentType;
	htmlDocumentMode: HtmlDocumentMode;
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

export type ExportTemplateSavePayload =
	| { mode: "create"; payload: NewReportTemplate }
	| { mode: "edit"; payload: UpdateReportTemplate };

const STANDARD_HTML_BODY_START = "<!-- hubuum-standard-body:start -->";
const STANDARD_HTML_BODY_END = "<!-- hubuum-standard-body:end -->";

export function createExportTemplateDraft(
	templateId: number | null = null,
): ExportTemplateDraft {
	return {
		mode: templateId == null ? "create" : "edit",
		templateId,
		collectionId: "",
		name: "",
		description: "",
		contentType: "text/plain",
		htmlDocumentMode: "standard",
		templateBody: `{% for item in items %}{{ item.name }}
{% endfor %}`,
		kind: "export",
		scopeKind: "objects_in_class",
		classId: "",
		defaultQuery: "",
		includeRows: [],
		depth: "",
		missingDataPolicy: "strict",
		maxItems: "",
		maxOutputBytes: "",
	};
}

function escapeHtmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function serializeTemplateBody(draft: ExportTemplateDraft): string {
	if (
		draft.contentType !== "text/html" ||
		draft.htmlDocumentMode === "full"
	) {
		return draft.templateBody;
	}

	const title = escapeHtmlText(draft.name.trim() || "Hubuum report");
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="generator" content="Hubuum">
	<title>${title}</title>
	<style>
		:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; }
		* { box-sizing: border-box; }
		body { margin: 0; color: #172033; background: #f5f7fb; }
		main { width: min(100% - 2rem, 76rem); margin: 2rem auto; padding: clamp(1rem, 3vw, 2.5rem); border: 1px solid #dfe4ec; border-radius: 14px; background: #fff; box-shadow: 0 16px 42px rgba(23, 32, 51, 0.08); }
		h1, h2, h3 { line-height: 1.2; text-wrap: balance; }
		table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
		th, td { padding: 0.65rem 0.75rem; border-bottom: 1px solid #dfe4ec; text-align: left; vertical-align: top; }
		th { background: #eef2f7; font-weight: 700; }
		tbody tr:nth-child(even) { background: #f8fafc; }
		tbody tr:hover { background: #eef6ff; }
		pre, code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
		pre { max-width: 100%; overflow: auto; padding: 1rem; border-radius: 8px; background: #eef2f7; }
		img { max-width: 100%; height: auto; }
		@media (prefers-color-scheme: dark) {
			body { color: #edf2f7; background: #111827; }
			main { border-color: #334155; background: #1f2937; box-shadow: none; }
			th, pre { background: #283548; }
			th, td { border-color: #3a475a; }
			tbody tr:nth-child(even) { background: #243044; }
			tbody tr:hover { background: #293b54; }
		}
		@media print {
			:root { color-scheme: light; }
			body { color: #000; background: #fff; }
			main { width: 100%; margin: 0; padding: 0; border: 0; box-shadow: none; }
			th { background: #eee !important; }
			tbody tr:nth-child(even) { background: #f7f7f7 !important; }
			a { color: inherit; text-decoration: none; }
		}
	</style>
</head>
<body>
<main>
${STANDARD_HTML_BODY_START}
${draft.templateBody}
${STANDARD_HTML_BODY_END}
</main>
</body>
</html>`;
}

export function parseStoredTemplateBody(
	contentType: StoredReportContentType,
	templateBody: string,
): Pick<ExportTemplateDraft, "htmlDocumentMode" | "templateBody"> {
	if (contentType !== "text/html") {
		return { htmlDocumentMode: "standard", templateBody };
	}

	const start = templateBody.indexOf(STANDARD_HTML_BODY_START);
	const end = templateBody.indexOf(STANDARD_HTML_BODY_END);
	if (start < 0 || end <= start) {
		return { htmlDocumentMode: "full", templateBody };
	}

	return {
		htmlDocumentMode: "standard",
		templateBody: templateBody
			.slice(start + STANDARD_HTML_BODY_START.length, end)
			.replace(/^\r?\n/, "")
			.replace(/\r?\n$/, ""),
	};
}

export function reportTemplateToExportTemplateDraft(
	template: ReportTemplate,
	makeId: () => string,
): ExportTemplateDraft {
	const contentType =
		template.content_type === "application/json"
			? "text/plain"
			: template.content_type;
	const parsedTemplateBody = parseStoredTemplateBody(
		contentType,
		template.template,
	);

	return {
		mode: "edit",
		templateId: template.id,
		collectionId: String(template.collection_id),
		name: template.name,
		description: template.description,
		contentType,
		htmlDocumentMode: parsedTemplateBody.htmlDocumentMode,
		templateBody: parsedTemplateBody.templateBody,
		kind: template.kind,
		scopeKind: template.scope_kind ?? "objects_in_class",
		classId: template.class_id != null ? String(template.class_id) : "",
		defaultQuery: template.default_query ?? "",
		includeRows: includeRowsFromTemplate(template.include, makeId),
		depth:
			template.relation_context?.depth != null
				? String(template.relation_context.depth)
				: "",
		missingDataPolicy: template.default_missing_data_policy ?? "strict",
		maxItems:
			template.default_limits?.max_items != null
				? String(template.default_limits.max_items)
				: "",
		maxOutputBytes:
			template.default_limits?.max_output_bytes != null
				? String(template.default_limits.max_output_bytes)
				: "",
	};
}

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
	| "identity"
	| "target"
	| "filters"
	| "related"
	| "rules"
	| "appearance"
	| "history";

export type ExportTemplateValidationContext = {
	classCollectionById?: ReadonlyMap<number, number>;
	relatedClassDepthStatus?: "loading" | "error" | "ready";
	relatedClassMinimumDepthById?: ReadonlyMap<number, number>;
};

export function duplicateExportTemplateDraft(
	draft: ExportTemplateDraft,
): ExportTemplateDraft {
	return {
		...draft,
		mode: "create",
		name: `${draft.name} copy`,
		templateId: null,
	};
}

export function buildExportTemplateSavePayload(
	draft: ExportTemplateDraft,
	validationContext: ExportTemplateValidationContext = {},
): ExportTemplateSavePayload {
	const collectionId = parsePositiveInteger(draft.collectionId);
	if (!collectionId) {
		throw new Error("Collection is required.");
	}

	const editableFields = {
		collection_id: collectionId,
		name: draft.name.trim(),
		description: draft.description.trim(),
		template: serializeTemplateBody(draft),
		kind: draft.kind,
	};
	type ReportFields = Pick<
		NewReportTemplate,
		| "class_id"
		| "default_limits"
		| "default_missing_data_policy"
		| "default_query"
		| "include"
		| "relation_context"
		| "scope_kind"
	>;
	let reportFields: Partial<ReportFields> = {};

	if (draft.kind === "export") {
		const scopeNeedsClass =
			draft.scopeKind === "objects_in_class" ||
			draft.scopeKind === "related_objects";
		const classId = parsePositiveInteger(draft.classId);
		const builtInclude = scopeNeedsClass
			? buildIncludeFromRows(draft.includeRows, {
					minimumDepthByClassId:
						validationContext.relatedClassMinimumDepthById,
					requireKnownClassDepth:
						validationContext.relatedClassDepthStatus === "ready",
				})
			: { include: null };
		if ("error" in builtInclude) {
			throw new Error(builtInclude.error);
		}

		const depth = draft.depth.trim() ? parsePositiveInteger(draft.depth) : null;
		const maxItems = draft.maxItems.trim()
			? parsePositiveInteger(draft.maxItems)
			: null;
		const maxOutputBytes = draft.maxOutputBytes.trim()
			? parsePositiveInteger(draft.maxOutputBytes)
			: null;
		reportFields = {
			scope_kind: draft.scopeKind,
			class_id: scopeNeedsClass ? classId : null,
			default_query: draft.defaultQuery.trim() || null,
			include: builtInclude.include,
			relation_context: depth ? { depth } : null,
			default_missing_data_policy: draft.missingDataPolicy,
			default_limits:
				maxItems != null || maxOutputBytes != null
					? { max_items: maxItems, max_output_bytes: maxOutputBytes }
					: null,
		};
	} else if (draft.mode === "edit") {
		reportFields = {
			scope_kind: null,
			class_id: null,
			default_query: null,
			include: null,
			relation_context: null,
			default_missing_data_policy: null,
			default_limits: null,
		};
	}

	if (draft.mode === "create") {
		return {
			mode: "create",
			payload: {
				...editableFields,
				...reportFields,
				content_type: draft.contentType,
			},
		};
	}

	return {
		mode: "edit",
		payload: {
			...editableFields,
			...reportFields,
		},
	};
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

export function validateExportTemplateIdentity(
	draft: ExportTemplateDraft,
): ExportTemplateDraftErrors {
	const errors: ExportTemplateDraftErrors = {};
	if (!draft.name.trim()) errors.name = "Enter a template name.";
	if (!draft.description.trim()) {
		errors.description = "Describe when this template should be used.";
	}
	return errors;
}

export function validateExportTemplateRelated(
	draft: ExportTemplateDraft,
	context: ExportTemplateValidationContext = {},
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
		if (
			draft.includeRows.length > 0 &&
			context.relatedClassDepthStatus !== undefined &&
			context.relatedClassDepthStatus !== "ready"
		) {
			errors.includeRows =
				context.relatedClassDepthStatus === "error"
					? "Retry loading related class paths before saving includes."
					: "Wait for related class paths before saving includes.";
			return errors;
		}
		const include = buildIncludeFromRows(draft.includeRows, {
			minimumDepthByClassId: context.relatedClassMinimumDepthById,
			requireKnownClassDepth: context.relatedClassDepthStatus === "ready",
		});
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
		...validateExportTemplateIdentity(draft),
		...validateExportTemplateTarget(draft, context),
		...validateExportTemplateRelated(draft, context),
		...validateExportTemplateRules(draft),
	};
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
	if (errors.name || errors.description) return "identity";
	if (errors.collectionId || errors.classId) return "target";
	if (errors.includeRows || errors.depth) return "related";
	if (errors.maxItems || errors.maxOutputBytes) return "rules";
	return "appearance";
}
