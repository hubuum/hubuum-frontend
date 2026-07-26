import type {
	ReportExecutionResult,
	ReportTemplate,
} from "@/lib/api/reporting";
import type {
	ExportLimits,
	ExportMissingDataPolicy,
} from "@/lib/api/generated/models";

export type ExportWorkspaceView = "run" | "templates" | "history";

export const EXPORT_ACTION_HINTS = {
	chooseObject:
		"Select the required root object and, if useful, add one-run overrides.",
	copyCustomizedLink:
		"Copy a bookmarkable report URL containing the current query and freshness overrides.",
	duplicate:
		"Create a separately named copy without changing this template.",
	editTemplate:
		"Permanently change this saved template's targets, defaults, layout, or content.",
	moreTemplateActions: "Edit or duplicate this report template.",
	refresh:
		"Generate one fresh result now, then open the clean bookmarkable report URL.",
	refreshCustomized:
		"Generate one fresh customized result, then open its clean bookmarkable URL.",
	runWithChanges:
		"Temporarily override query, freshness, missing-data rules, or limits without editing the template.",
	view:
		"Open the latest acceptable result in a new tab, generating one if needed.",
	viewCustomized:
		"Open this customized report in a new tab without changing the saved template.",
	viewSaved:
		"Open the stable report page in a new tab, using the saved defaults and latest acceptable result.",
	viewSavedLatest:
		"Open the stable report page in a new tab, using the latest acceptable result.",
} as const;

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

export function formatExportBytes(byteCount: number): string {
	if (byteCount < 1024) {
		return `${byteCount} B`;
	}
	if (byteCount < 1024 * 1024) {
		return `${(byteCount / 1024).toFixed(1)} KiB`;
	}

	return `${(byteCount / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatExportTimestamp(
	value: string | null | undefined,
	fallback = "n/a",
): string {
	if (!value) {
		return fallback;
	}

	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

export function getReportResultText(result: ReportExecutionResult): string {
	if (typeof result.text === "string") {
		return result.text;
	}

	return result.json ? JSON.stringify(result.json, null, 2) : "";
}

export function getExportResultHref(taskId: number): string {
	return `/reports/runs/${taskId}`;
}

export type BookmarkableReportOverrides = {
	limits?: ExportLimits | null;
	max_age?: number | string | null;
	missing_data_policy?: ExportMissingDataPolicy | null;
	object_id?: number | null;
	query?: string | null;
};

function getBookmarkableReportSearchParams(
	overrides: BookmarkableReportOverrides = {},
): URLSearchParams {
	const searchParams = new URLSearchParams();
	if (typeof overrides.query === "string") {
		searchParams.set("query", overrides.query.trim());
	}
	if (overrides.object_id != null) {
		searchParams.set("object_id", String(overrides.object_id));
	}
	if (overrides.missing_data_policy) {
		searchParams.set("missing_data_policy", overrides.missing_data_policy);
	}
	if (overrides.limits?.max_items != null) {
		searchParams.set("max_items", String(overrides.limits.max_items));
	}
	if (overrides.limits?.max_output_bytes != null) {
		searchParams.set(
			"max_output_bytes",
			String(overrides.limits.max_output_bytes),
		);
	}
	if (overrides.max_age != null) {
		searchParams.set("max_age", String(overrides.max_age));
	}

	return searchParams;
}

function buildReportHref(
	path: string,
	overrides: BookmarkableReportOverrides = {},
): string {
	const searchParams = getBookmarkableReportSearchParams(overrides);
	const queryString = searchParams.toString();
	return `${path}${queryString ? `?${queryString}` : ""}`;
}

export function getBookmarkableReportHref(
	templateId: number,
	overrides: BookmarkableReportOverrides = {},
): string {
	return buildReportHref(`/reports/${templateId}`, overrides);
}

export function getReportConfigurationHref(
	templateId: number,
	overrides: BookmarkableReportOverrides = {},
): string {
	return buildReportHref(`/exports/reports/${templateId}`, overrides);
}

export function getReportRefreshHref(
	templateId: number,
	overrides: BookmarkableReportOverrides = {},
): string {
	return buildReportHref(`/reports/${templateId}/refresh`, overrides);
}
