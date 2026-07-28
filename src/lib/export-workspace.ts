import type {
	ReportExecutionResult,
	ReportTemplate,
} from "@/lib/api/reporting";
import type {
	ExportLimits,
	ExportMissingDataPolicy,
} from "@/lib/api/generated/models";
import {
	formatReportQueryField,
	formatReportQueryOperator,
} from "@/lib/report-query";
import type { ReportResultStatus } from "@/lib/report-result-status";

export type ExportWorkspaceView = "run" | "one-off" | "templates" | "history";

export const EXPORT_ACTION_HINTS = {
	chooseObject:
		"Select the required root object and, if useful, add one-run overrides.",
	copyCustomizedLink:
		"Copy a bookmarkable report URL containing the current query and freshness overrides.",
	duplicate: "Create a separately named copy without changing this template.",
	editTemplate:
		"Permanently change this saved template's targets, defaults, layout, or content.",
	moreTemplateActions: "Edit or duplicate this report template.",
	refresh:
		"Generate one fresh result now, then open the clean bookmarkable report URL.",
	refreshCustomized:
		"Generate one fresh customized result, then open its clean bookmarkable URL.",
	runWithChanges:
		"Temporarily override query, freshness, missing-data rules, or limits without editing the template.",
	view: "Open the latest acceptable result in a new tab, generating one if needed.",
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

function formatSavedQueryField(value: string): string {
	const computedMatch = value.match(
		/^computed\.(shared|personal)\.([a-z][a-z0-9_]*)$/i,
	);
	if (computedMatch) {
		return `${computedMatch[1] === "shared" ? "Shared" : "Personal"} computed · ${formatReportQueryField(computedMatch[2])}`;
	}
	if (value === "json_data") {
		return "Data";
	}
	return formatReportQueryField(value).replace(/\bId\b/g, "ID");
}

function formatSavedQueryValue(value: string): string {
	let readable = value.trim().replace(/\s+/g, " ");
	try {
		const parsed: unknown = JSON.parse(readable);
		if (typeof parsed === "string") {
			readable = parsed;
		} else if (
			Array.isArray(parsed) &&
			parsed.every(
				(item) =>
					typeof item === "string" ||
					typeof item === "number" ||
					typeof item === "boolean",
			)
		) {
			readable = parsed.join(", ");
		} else if (
			parsed === null ||
			typeof parsed === "number" ||
			typeof parsed === "boolean"
		) {
			readable = String(parsed);
		}
	} catch {
		// Query values are usually plain strings rather than JSON.
	}

	return readable.length > 96 ? `${readable.slice(0, 93)}…` : readable;
}

function formatSavedQueryOperator(value: string): string {
	if (!value.startsWith("not_")) {
		return formatReportQueryOperator(value).toLocaleLowerCase();
	}

	const baseOperator = value.slice(4);
	const negativeLabels: Record<string, string> = {
		contains: "does not contain",
		equals: "does not equal",
		icontains: "does not contain, ignoring case",
		iendswith: "does not end with, ignoring case",
		iequals: "does not equal, ignoring case",
		istartswith: "does not start with, ignoring case",
	};
	return (
		negativeLabels[baseOperator] ??
		`not ${formatReportQueryOperator(baseOperator).toLocaleLowerCase()}`
	);
}

function describeSavedQueryFilter(key: string, value: string): string {
	const operatorIndex = key.lastIndexOf("__");
	const rawField = operatorIndex > 0 ? key.slice(0, operatorIndex) : key;
	const operator = operatorIndex > 0 ? key.slice(operatorIndex + 2) : "equals";
	let field = formatSavedQueryField(rawField);
	let readableValue = value;

	if (rawField === "json_data") {
		const pathSeparator = value.indexOf("=");
		if (pathSeparator >= 0) {
			const path = value
				.slice(0, pathSeparator)
				.split(",")
				.filter(Boolean)
				.map(formatSavedQueryField)
				.join(" · ");
			field = path ? `Data · ${path}` : "Data";
			readableValue = value.slice(pathSeparator + 1);
		} else if (operator === "is_null") {
			const path = value
				.split(",")
				.filter(Boolean)
				.map(formatSavedQueryField)
				.join(" · ");
			field = path ? `Data · ${path}` : "Data";
			readableValue = "";
		}
	}

	const operatorLabel = formatSavedQueryOperator(operator);
	const formattedValue = formatSavedQueryValue(readableValue);
	return formattedValue
		? `${field} ${operatorLabel} “${formattedValue}”`
		: `${field} ${operatorLabel}`;
}

function describeSavedQuerySort(value: string): string[] {
	return value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const descending = part.startsWith("-") || part.endsWith(".desc");
			const field = part.replace(/^-/, "").replace(/\.(?:asc|desc)$/, "");
			return `${formatSavedQueryField(field)} ${
				descending ? "descending" : "ascending"
			}`;
		});
}

export function describeSavedReportQuery(query: string | null | undefined): {
	hint: string;
	label: string;
} {
	if (!query?.trim()) {
		return {
			hint: "No saved filters or sorting; the report uses the full selected scope.",
			label: "No filters",
		};
	}

	const filters: string[] = [];
	const sorts: string[] = [];
	const params = new URLSearchParams(
		query.startsWith("?") ? query.slice(1) : query,
	);
	params.forEach((value, key) => {
		if (key === "sort") {
			sorts.push(...describeSavedQuerySort(value));
			return;
		}
		if (key !== "cursor") {
			filters.push(describeSavedQueryFilter(key, value));
		}
	});

	const counts = [
		filters.length
			? `${filters.length} ${filters.length === 1 ? "filter" : "filters"}`
			: null,
		sorts.length
			? `${sorts.length} ${sorts.length === 1 ? "sort" : "sorts"}`
			: null,
	].filter((value): value is string => value !== null);
	const details = [
		filters.length ? `Filters — ${filters.join("; ")}.` : null,
		sorts.length ? `Sort — ${sorts.join("; ")}.` : null,
	].filter((value): value is string => value !== null);

	return {
		hint:
			details.join(" ") ||
			"Saved query settings are present, but contain no displayable filters or sorting.",
		label: counts.length
			? `Saved query · ${counts.join(" · ")}`
			: "Saved query",
	};
}

export function describeLatestReportResult({
	error = false,
	loading = false,
	needsObject = false,
	status,
}: {
	error?: boolean;
	loading?: boolean;
	needsObject?: boolean;
	status?: ReportResultStatus | null;
}): { hint: string; label: string } {
	if (needsObject) {
		return {
			hint: "Choose the required root object before generating this report.",
			label: "Latest export: choose object",
		};
	}
	if (loading) {
		return {
			hint: "Checking the saved result for the current template version.",
			label: "Latest export: checking",
		};
	}
	if (error) {
		return {
			hint: "Result status could not be loaded. View still opens or generates the report.",
			label: "Latest export: status unavailable",
		};
	}
	if (!status || status.state === "missing") {
		return {
			hint: "View generates the first result for the current template version.",
			label: "Latest export: none yet",
		};
	}
	if (status.state === "generating") {
		return {
			hint: "The saved-default export for this template is still running.",
			label: "Latest export: generating",
		};
	}

	const generated = status.generatedAt
		? formatExportTimestamp(status.generatedAt)
		: null;
	if (status.state === "available") {
		const expiry = status.outputExpiresAt
			? formatExportTimestamp(status.outputExpiresAt)
			: null;
		return {
			hint: expiry
				? `Stored output is available until ${expiry}. View reuses it until then and regenerates after it expires.`
				: "Stored output is available. View reuses it until it expires, then regenerates automatically.",
			label: generated
				? `Latest export: ${generated}`
				: "Latest export: available",
		};
	}
	if (status.state === "expired") {
		return {
			hint: "The stored output has expired. View generates a fresh result.",
			label: generated
				? `Latest export: ${generated} · expired`
				: "Latest export: expired",
		};
	}

	return {
		hint: "No stored output is available. View generates a fresh result.",
		label: generated
			? `Latest export: ${generated} · unavailable`
			: "Latest export: unavailable",
	};
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
