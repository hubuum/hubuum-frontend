import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";

export type StoredReportContentType = "text/plain" | "text/html" | "text/csv";
export type ReportContentType = "application/json" | StoredReportContentType;
export type ReportMissingDataPolicy = "strict" | "null" | "omit";
export type ReportScopeKind =
  | "namespaces"
  | "classes"
  | "objects_in_class"
  | "class_relations"
  | "object_relations"
  | "related_objects";

export type ReportTemplate = {
  id: number;
  namespace_id: number;
  name: string;
  description: string;
  content_type: StoredReportContentType;
  template: string;
  created_at: string;
  updated_at: string;
};

export type NewReportTemplate = {
  namespace_id: number;
  name: string;
  description: string;
  content_type: StoredReportContentType;
  template: string;
};

export type UpdateReportTemplate = {
  namespace_id?: number | null;
  name?: string | null;
  description?: string | null;
  template?: string | null;
};

export type ReportScope = {
  kind: ReportScopeKind;
  class_id?: number | null;
  object_id?: number | null;
};

export type ReportLimits = {
  max_items?: number | null;
  max_output_bytes?: number | null;
};

export type ReportOutputRequest = {
  template_id?: number | null;
};

export type ReportRequest = {
  scope: ReportScope;
  query?: string | null;
  output?: ReportOutputRequest | null;
  missing_data_policy?: ReportMissingDataPolicy | null;
  limits?: ReportLimits | null;
};

export type ReportWarning = {
  code: string;
  message: string;
  path?: string | null;
};

export type ReportJsonResponse = {
  items: unknown[];
  meta: {
    count: number;
    truncated: boolean;
    scope: ReportScope;
    content_type: ReportContentType;
  };
  warnings: ReportWarning[];
};

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

type JsonRequestOptions = RequestInit & {
  fallbackMessage: string;
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

async function requestJson<T>(path: string, options: JsonRequestOptions): Promise<{ data: T; headers: Headers }> {
  const { fallbackMessage, ...init } = options;
  const response = await fetch(path, {
    credentials: "include",
    ...init
  });
  const payload = await parseBody(response);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, fallbackMessage));
  }

  return {
    data: payload as T,
    headers: response.headers
  };
}

function toReportContentType(value: string | null): ReportContentType {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "text/plain" || normalized === "text/html" || normalized === "text/csv") {
    return normalized;
  }

  return "application/json";
}

export async function listReportTemplates(cursor?: string | null): Promise<ReportTemplatePage> {
  const params = new URLSearchParams({
    limit: "100",
    sort: "updated_at.desc"
  });

  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await requestJson<unknown>(`/api/v1/templates?${params.toString()}`, {
    fallbackMessage: "Failed to load report templates."
  });

  return {
    items: expectArrayPayload<ReportTemplate>(response.data, "report templates"),
    nextCursor: response.headers.get("x-next-cursor")
  };
}

export async function createReportTemplate(payload: NewReportTemplate): Promise<ReportTemplate> {
  const response = await requestJson<ReportTemplate>("/api/v1/templates", {
    fallbackMessage: "Failed to create report template.",
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return response.data;
}

export async function updateReportTemplate(templateId: number, payload: UpdateReportTemplate): Promise<ReportTemplate> {
  const response = await requestJson<ReportTemplate>(`/api/v1/templates/${templateId}`, {
    fallbackMessage: "Failed to update report template.",
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return response.data;
}

export async function deleteReportTemplate(templateId: number): Promise<void> {
  const response = await fetch(`/api/v1/templates/${templateId}`, {
    credentials: "include",
    method: "DELETE"
  });

  if (response.status !== 204) {
    const payload = await parseBody(response);
    throw new Error(getApiErrorMessage(payload, "Failed to delete report template."));
  }
}

export async function runReport(
  request: ReportRequest,
  preferredContentType: ReportContentType
): Promise<ReportExecutionResult> {
  const response = await fetch("/api/v1/reports", {
    credentials: "include",
    method: "POST",
    headers: {
      Accept: preferredContentType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  const contentType = toReportContentType(response.headers.get("content-type"));
  const warningCount = Number.parseInt(response.headers.get("x-hubuum-report-warnings") ?? "0", 10) || 0;
  const truncated = response.headers.get("x-hubuum-report-truncated") === "true";

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
      text: payload ? JSON.stringify(payload, null, 2) : null
    };
  }

  return {
    contentType,
    warningCount,
    truncated,
    json: null,
    text: (await response.text()) || ""
  };
}
