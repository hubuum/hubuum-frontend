import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1ExportTemplatesByTemplateId,
	getApiV1ExportTemplates,
	getApiV1ExportTemplatesByTemplateId,
	getApiV1ExportTemplatesByTemplateIdHistory,
	getApiV1ExportsByTaskId,
	patchApiV1ExportTemplatesByTemplateId,
	postApiV1ExportTemplates,
	postApiV1ExportTemplatesByTemplateIdExports,
	postApiV1Exports,
} from "@/lib/api/generated/client";
import type {
	ExportContentType,
	ExportInclude,
	ExportIncludeRelatedDirection,
	ExportIncludeRelatedObject,
	ExportIncludeRelatedSort,
	ExportJsonResponse,
	ExportLimits,
	ExportMissingDataPolicy,
	ExportRelationContext,
	ExportRequest,
	ExportScopeKind,
	ExportTemplate,
	ExportTemplateKind,
	ExportTemplateRunRequest,
	GetApiV1ExportTemplatesParams,
	HistoryResponseExportTemplateHistory,
	NewExportTemplate,
	TaskResponse,
	UpdateExportTemplate,
} from "@/lib/api/generated/models";

export type NewReportTemplate = NewExportTemplate;
export type ReportContentType = ExportContentType;
export type ReportInclude = ExportInclude;
export type ReportIncludeRelatedDirection = ExportIncludeRelatedDirection;
export type ReportIncludeRelatedObject = ExportIncludeRelatedObject;
export type ReportIncludeRelatedSort = ExportIncludeRelatedSort;
export type ReportJsonResponse = ExportJsonResponse;
export type ReportLimits = ExportLimits;
export type ReportMissingDataPolicy = ExportMissingDataPolicy;
export type ReportRelationContext = ExportRelationContext;
export type ReportRequest = ExportRequest;
export type ReportScopeKind = ExportScopeKind;
export type ReportTemplate = ExportTemplate;
export type ReportTemplateHistory = HistoryResponseExportTemplateHistory;
export type ReportTemplateKind = ExportTemplateKind;
export type ReportTemplateRunRequest = ExportTemplateRunRequest;
export type UpdateReportTemplate = UpdateExportTemplate;
export type { TaskResponse };

export type StoredReportContentType = Exclude<
	ReportContentType,
	"application/json"
>;

export type ReportExecutionResult = {
	contentType: ReportContentType;
	warningCount: number;
	truncated: boolean;
	json: ReportJsonResponse | null;
	text: string | null;
};

export type ReportTemplatePage = {
	items: ReportTemplate[];
	nextCursor: string | null;
};

async function parseBody(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) {
		try {
			return await response.json();
		} catch {
			return null;
		}
	}

	const text = await response.text();
	return text || null;
}

function toReportContentType(value: string | null): ReportContentType {
	const normalized = value?.split(";")[0]?.trim().toLowerCase();
	if (
		normalized === "text/plain" ||
		normalized === "text/html" ||
		normalized === "text/csv" ||
		normalized === "application/json"
	) {
		return normalized;
	}

	return "application/json";
}

export async function listReportTemplates(
	cursor?: string | null,
): Promise<ReportTemplatePage> {
	const params: GetApiV1ExportTemplatesParams = {
		include_total: false,
		limit: 100,
		sort: "updated_at.desc",
	};

	if (cursor) {
		params.cursor = cursor;
	}

	const response = await getApiV1ExportTemplates(params, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load export templates."),
		);
	}

	return {
		items: response.data,
		nextCursor: response.headers.get("x-next-cursor"),
	};
}

export async function getReportTemplate(
	templateId: number,
): Promise<ReportTemplate> {
	const response = await getApiV1ExportTemplatesByTemplateId(templateId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load export template."),
		);
	}

	return response.data;
}

export async function listReportTemplateHistory(
	templateId: number,
): Promise<ReportTemplateHistory[]> {
	const response = await getApiV1ExportTemplatesByTemplateIdHistory(
		templateId,
		{ include_total: false, limit: 50, sort: "valid_from.desc" },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load template history."),
		);
	}

	return response.data;
}

export async function createReportTemplate(
	payload: NewReportTemplate,
): Promise<ReportTemplate> {
	const response = await postApiV1ExportTemplates(payload, {
		credentials: "include",
	});

	if (response.status !== 201) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to create export template."),
		);
	}

	return response.data;
}

export async function updateReportTemplate(
	templateId: number,
	payload: UpdateReportTemplate,
): Promise<ReportTemplate> {
	const response = await patchApiV1ExportTemplatesByTemplateId(
		templateId,
		payload,
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to update export template."),
		);
	}

	return response.data;
}

export async function deleteReportTemplate(templateId: number): Promise<void> {
	const response = await deleteApiV1ExportTemplatesByTemplateId(templateId, {
		credentials: "include",
	});

	if (response.status !== 204) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to delete export template."),
		);
	}
}

export async function submitJsonReportTask(
	request: ReportRequest,
	idempotencyKey?: string,
): Promise<TaskResponse> {
	const headers = new Headers();
	if (idempotencyKey?.trim()) {
		headers.set("Idempotency-Key", idempotencyKey.trim());
	}

	const response = await postApiV1Exports(request, {
		credentials: "include",
		headers,
	});

	if ((response.status as number) === 429) {
		throw new Error(
			"Too many active export tasks. Wait for one to finish, then try again.",
		);
	}
	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to submit export."),
		);
	}
	return response.data;
}

export async function runTemplateReport(
	templateId: number,
	overrides: ReportTemplateRunRequest,
	idempotencyKey?: string,
): Promise<TaskResponse> {
	const headers = new Headers();
	if (idempotencyKey?.trim()) {
		headers.set("Idempotency-Key", idempotencyKey.trim());
	}

	const response = await postApiV1ExportTemplatesByTemplateIdExports(
		templateId,
		overrides,
		{ credentials: "include", headers },
	);

	if ((response.status as number) === 429) {
		throw new Error(
			"Too many active export tasks. Wait for one to finish, then try again.",
		);
	}
	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to run template export."),
		);
	}
	return response.data;
}

export async function fetchReportTask(taskId: number): Promise<TaskResponse> {
	const response = await getApiV1ExportsByTaskId(taskId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load export task."),
		);
	}

	return response.data;
}

export async function fetchReportOutput(
	taskId: number,
	preferredContentType?: ReportContentType | string | null,
): Promise<ReportExecutionResult> {
	const headers = new Headers();
	if (preferredContentType?.trim()) {
		headers.set("Accept", preferredContentType.trim());
	}

	const response = await fetch(
		`/_hubuum-bff/hubuum/api/v1/exports/${taskId}/output`,
		{
			credentials: "include",
			headers,
		},
	);

	const contentType = toReportContentType(response.headers.get("content-type"));
	const warningCount =
		Number.parseInt(
			response.headers.get("x-hubuum-export-warnings") ?? "0",
			10,
		) || 0;
	const truncated =
		response.headers.get("x-hubuum-export-truncated") === "true";

	if (response.status === 404 || response.status === 410) {
		throw new Error(
			"This export output has expired or was cleaned up. Re-run the export to generate it again.",
		);
	}

	if (!response.ok) {
		const payload = await parseBody(response);
		throw new Error(
			getApiErrorMessage(payload, "Failed to fetch export output."),
		);
	}

	if (contentType === "application/json") {
		const payload = (await parseBody(response)) as ReportJsonResponse | null;
		return {
			contentType,
			warningCount,
			truncated: payload?.meta.truncated ?? truncated,
			json: payload,
			text: payload ? JSON.stringify(payload, null, 2) : null,
		};
	}

	return {
		contentType,
		warningCount,
		truncated,
		json: null,
		text: (await response.text()) || "",
	};
}
