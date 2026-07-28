export const REPORT_RESULT_STATES = [
	"available",
	"expired",
	"generating",
	"missing",
	"unavailable",
] as const;

export type ReportResultState = (typeof REPORT_RESULT_STATES)[number];

export type ReportResultStatusRequestItem = {
	revision: string;
	templateId: number;
};

export type ReportResultStatus = {
	generatedAt: string | null;
	outputExpiresAt: string | null;
	state: ReportResultState;
	taskId: number | null;
	templateId: number;
};

const MAX_STATUS_ITEMS = 100;
const MAX_REVISION_LENGTH = 128;
const resultStates = new Set<string>(REPORT_RESULT_STATES);

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOptionalTimestamp(value: unknown): value is string | null {
	return (
		value === null ||
		(typeof value === "string" &&
			value.length > 0 &&
			value.length <= MAX_REVISION_LENGTH &&
			!Number.isNaN(Date.parse(value)))
	);
}

export function parseReportResultStatusRequest(
	value: unknown,
): ReportResultStatusRequestItem[] | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const templates = (value as { templates?: unknown }).templates;
	if (
		!Array.isArray(templates) ||
		templates.length === 0 ||
		templates.length > MAX_STATUS_ITEMS
	) {
		return null;
	}

	const seenTemplateIds = new Set<number>();
	const parsed: ReportResultStatusRequestItem[] = [];
	for (const item of templates) {
		if (!item || typeof item !== "object") {
			return null;
		}

		const candidate = item as {
			revision?: unknown;
			templateId?: unknown;
		};
		if (
			!isPositiveInteger(candidate.templateId) ||
			typeof candidate.revision !== "string" ||
			candidate.revision.length === 0 ||
			candidate.revision.length > MAX_REVISION_LENGTH ||
			Number.isNaN(Date.parse(candidate.revision)) ||
			seenTemplateIds.has(candidate.templateId)
		) {
			return null;
		}

		seenTemplateIds.add(candidate.templateId);
		parsed.push({
			revision: candidate.revision,
			templateId: candidate.templateId,
		});
	}

	return parsed;
}

export function parseReportResultStatusResponse(
	value: unknown,
): ReportResultStatus[] | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const results = (value as { results?: unknown }).results;
	if (!Array.isArray(results) || results.length > MAX_STATUS_ITEMS) {
		return null;
	}

	const parsed: ReportResultStatus[] = [];
	const seenTemplateIds = new Set<number>();
	for (const item of results) {
		if (!item || typeof item !== "object") {
			return null;
		}

		const candidate = item as {
			generatedAt?: unknown;
			outputExpiresAt?: unknown;
			state?: unknown;
			taskId?: unknown;
			templateId?: unknown;
		};
		if (
			!isPositiveInteger(candidate.templateId) ||
			(typeof candidate.taskId !== "number" && candidate.taskId !== null) ||
			(candidate.taskId !== null && !isPositiveInteger(candidate.taskId)) ||
			!isOptionalTimestamp(candidate.generatedAt) ||
			!isOptionalTimestamp(candidate.outputExpiresAt) ||
			typeof candidate.state !== "string" ||
			!resultStates.has(candidate.state) ||
			seenTemplateIds.has(candidate.templateId)
		) {
			return null;
		}

		seenTemplateIds.add(candidate.templateId);
		parsed.push({
			generatedAt: candidate.generatedAt,
			outputExpiresAt: candidate.outputExpiresAt,
			state: candidate.state as ReportResultState,
			taskId: candidate.taskId,
			templateId: candidate.templateId,
		});
	}

	return parsed;
}
