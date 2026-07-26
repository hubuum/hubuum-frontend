import type {
	ReportMissingDataPolicy,
	ReportTemplate,
} from "@/lib/api/reporting";
import type { BookmarkableReportOverrides } from "@/lib/export-workspace";
import { parseReportMaxAge } from "@/lib/report-max-age";

export type ReportConfiguratorValues = {
	maxAge: string;
	maxItems: string;
	maxOutputBytes: string;
	missingDataPolicy: ReportMissingDataPolicy | "";
	objectId: string;
	query: string;
};

function parseOptionalInteger(
	value: string,
	label: string,
	minimum: number,
): number | null {
	const normalized = value.trim();
	if (!normalized) {
		return null;
	}
	if (!/^\d+$/.test(normalized)) {
		throw new Error(`${label} must be a whole number.`);
	}

	const parsed = Number.parseInt(normalized, 10);
	if (!Number.isSafeInteger(parsed) || parsed < minimum) {
		throw new Error(`${label} must be at least ${minimum}.`);
	}
	return parsed;
}

export function buildBookmarkableReportOverrides(
	values: ReportConfiguratorValues,
	template: Pick<ReportTemplate, "scope_kind">,
	queryOverrideEnabled: boolean,
): BookmarkableReportOverrides {
	const objectId = parseOptionalInteger(values.objectId, "Root object ID", 1);
	if (template.scope_kind === "related_objects" && objectId === null) {
		throw new Error("Choose a root object before opening this report.");
	}

	const maxItems = parseOptionalInteger(values.maxItems, "Maximum items", 0);
	const maxOutputBytes = parseOptionalInteger(
		values.maxOutputBytes,
		"Maximum output size",
		0,
	);
	const maxAge = parseReportMaxAge(values.maxAge);
	if (!maxAge.ok) {
		throw new Error(maxAge.message);
	}
	if (maxAge.maxAgeMilliseconds === 0) {
		throw new Error(
			'Use “Refresh now” for a one-time forced update instead of bookmarking a zero maximum age.',
		);
	}

	return {
		limits: {
			max_items: maxItems,
			max_output_bytes: maxOutputBytes,
		},
		max_age: values.maxAge.trim() || null,
		missing_data_policy: values.missingDataPolicy || null,
		object_id: template.scope_kind === "related_objects" ? objectId : null,
		query: queryOverrideEnabled ? values.query.trim() : null,
	};
}
