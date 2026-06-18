import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1TemplatesByTemplateId,
	getApiV1ReportsByTaskId,
	getApiV1Templates,
	patchApiV1TemplatesByTemplateId,
	postApiV1Reports,
	postApiV1Templates,
} from "@/lib/api/generated/client";
import type {
	GetApiV1TemplatesParams,
	NewReportTemplate,
	ReportContentType,
	ReportJsonResponse,
	ReportMissingDataPolicy,
	ReportRequest,
	ReportScopeKind,
	ReportTemplate,
	TaskResponse,
	UpdateReportTemplate,
} from "@/lib/api/generated/models";

export type {
	NewReportTemplate,
	ReportContentType,
	ReportJsonResponse,
	ReportMissingDataPolicy,
	ReportRequest,
	ReportScopeKind,
	ReportTemplate,
	TaskResponse,
	UpdateReportTemplate,
};

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
	const params: GetApiV1TemplatesParams = {
		limit: 100,
		sort: "updated_at.desc",
	};

	if (cursor) {
		params.cursor = cursor;
	}

	const response = await getApiV1Templates(params, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load report templates."),
		);
	}

	return {
		items: response.data,
		nextCursor: response.headers.get("x-next-cursor"),
	};
}

export async function createReportTemplate(
	payload: NewReportTemplate,
): Promise<ReportTemplate> {
	const response = await postApiV1Templates(payload, {
		credentials: "include",
	});

	if (response.status !== 201) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to create report template."),
		);
	}

	return response.data;
}

export async function updateReportTemplate(
	templateId: number,
	payload: UpdateReportTemplate,
): Promise<ReportTemplate> {
	const response = await patchApiV1TemplatesByTemplateId(templateId, payload, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to update report template."),
		);
	}

	return response.data;
}

export async function deleteReportTemplate(templateId: number): Promise<void> {
	const response = await deleteApiV1TemplatesByTemplateId(templateId, {
		credentials: "include",
	});

	if (response.status !== 204) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to delete report template."),
		);
	}
}

export async function submitReportTask(
	request: ReportRequest,
	idempotencyKey?: string,
): Promise<TaskResponse> {
	const headers = new Headers();

	if (idempotencyKey?.trim()) {
		headers.set("Idempotency-Key", idempotencyKey.trim());
	}

	const response = await postApiV1Reports(request, {
		credentials: "include",
		headers,
	});

	if ((response.status as number) === 429) {
		throw new Error(
			"Too many active report tasks. Wait for one to finish, then try again.",
		);
	}

	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to submit report."),
		);
	}

	return response.data;
}

export async function fetchReportTask(taskId: number): Promise<TaskResponse> {
	const response = await getApiV1ReportsByTaskId(taskId, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load report task."),
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
		`/_hubuum-bff/hubuum/api/v1/reports/${taskId}/output`,
		{
			credentials: "include",
			headers,
		},
	);

	const contentType = toReportContentType(response.headers.get("content-type"));
	const warningCount =
		Number.parseInt(
			response.headers.get("x-hubuum-report-warnings") ?? "0",
			10,
		) || 0;
	const truncated =
		response.headers.get("x-hubuum-report-truncated") === "true";

	if (response.status === 404 || response.status === 410) {
		throw new Error(
			"This report output has expired or was cleaned up. Re-run the report to generate it again.",
		);
	}

	if (!response.ok) {
		const payload = await parseBody(response);
		throw new Error(getApiErrorMessage(payload, "Failed to fetch report output."));
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
