import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1TemplatesByTemplateId,
	getApiV1Templates,
	patchApiV1TemplatesByTemplateId,
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

export async function runReport(
	request: ReportRequest,
	preferredContentType: ReportContentType,
): Promise<ReportExecutionResult> {
	const response = await fetch("/api/v1/reports", {
		credentials: "include",
		method: "POST",
		headers: {
			Accept: preferredContentType,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(request),
	});

	const contentType = toReportContentType(response.headers.get("content-type"));
	const warningCount =
		Number.parseInt(
			response.headers.get("x-hubuum-report-warnings") ?? "0",
			10,
		) || 0;
	const truncated =
		response.headers.get("x-hubuum-report-truncated") === "true";

	if (!response.ok) {
		const payload = await parseBody(response);
		throw new Error(getApiErrorMessage(payload, "Failed to run report."));
	}

	if (contentType === "application/json") {
		const payload = (await parseBody(response)) as ReportJsonResponse | null;
		return {
			contentType,
			warningCount,
			truncated,
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
