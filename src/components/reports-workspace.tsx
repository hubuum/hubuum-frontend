"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { CreateModal } from "@/components/create-modal";
import { TemplateCodeEditor } from "@/components/template-code-editor";
import {
  createReportTemplate,
  deleteReportTemplate,
  listReportTemplates,
  runReport,
  updateReportTemplate,
  type NewReportTemplate,
  type ReportContentType,
  type ReportExecutionResult,
  type ReportMissingDataPolicy,
  type ReportRequest,
  type ReportScopeKind,
  type ReportTemplate,
  type StoredReportContentType,
  type UpdateReportTemplate
} from "@/lib/api/reporting";
import { getApiV1Classes, getApiV1ClassesByClassIdTrailing, getApiV1Namespaces } from "@/lib/api/generated/client";
import type { HubuumClassExpanded, HubuumObject, Namespace } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

type TemplateEditorState = {
  mode: "create" | "edit";
  templateId: number | null;
  namespaceId: string;
  name: string;
  description: string;
  contentType: StoredReportContentType;
  templateBody: string;
};

type QueryFieldKind = "string" | "number" | "date" | "boolean" | "array" | "json";

type QueryFieldDefinition = {
  key: string;
  kind: QueryFieldKind;
  sortable: boolean;
};

type QueryBuilderFilter = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

type QueryBuilderSort = {
  id: string;
  field: string;
  direction: "asc" | "desc";
};

type ResultActionFeedback =
  | {
      tone: "success" | "danger";
      message: string;
    }
  | null;

type ReportResultView = {
  fullText: string;
  previewText: string;
  totalBytes: number;
  previewBytes: number;
  previewCapped: boolean;
  canCopyFull: boolean;
  showInlineHtmlPreview: boolean;
};

const TEMPLATE_HELP = [
  "{{path.to.value}} interpolates a value.",
  "{{#each items}} ... {{/each}} loops arrays.",
  "Use this.name inside loops and root.meta to reference the full context.",
  "Stored templates support text/plain, text/html, and text/csv."
] as const;

const DEFAULT_TEMPLATE_EDITOR: TemplateEditorState = {
  mode: "create",
  templateId: null,
  namespaceId: "",
  name: "",
  description: "",
  contentType: "text/plain",
  templateBody: "{{#each items}}{{this.name}}\n{{/each}}"
};

const STRING_OPERATORS = [
  "equals",
  "iequals",
  "contains",
  "icontains",
  "startswith",
  "istartswith",
  "endswith",
  "iendswith",
  "like",
  "regex"
] as const;
const NUMBER_OPERATORS = ["equals", "gt", "gte", "lt", "lte", "between"] as const;
const ARRAY_OPERATORS = ["equals", "contains"] as const;
const BOOLEAN_OPERATORS = ["equals"] as const;
const JSON_OPERATORS = ["equals", "contains", "gt", "gte", "lt", "lte", "between"] as const;
const PREVIEW_BYTE_LIMIT = 64 * 1024;
const FULL_COPY_BYTE_LIMIT = 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const SCOPE_QUERY_FIELDS: Record<ReportScopeKind, QueryFieldDefinition[]> = {
  namespaces: [
    { key: "id", kind: "number", sortable: true },
    { key: "name", kind: "string", sortable: true },
    { key: "description", kind: "string", sortable: false },
    { key: "created_at", kind: "date", sortable: true },
    { key: "updated_at", kind: "date", sortable: true },
    { key: "permissions", kind: "array", sortable: false }
  ],
  classes: [
    { key: "id", kind: "number", sortable: true },
    { key: "namespaces", kind: "number", sortable: true },
    { key: "namespace_id", kind: "number", sortable: true },
    { key: "name", kind: "string", sortable: true },
    { key: "description", kind: "string", sortable: false },
    { key: "validate_schema", kind: "boolean", sortable: false },
    { key: "json_schema", kind: "json", sortable: false },
    { key: "created_at", kind: "date", sortable: true },
    { key: "updated_at", kind: "date", sortable: true },
    { key: "permissions", kind: "array", sortable: false }
  ],
  objects_in_class: [
    { key: "id", kind: "number", sortable: true },
    { key: "name", kind: "string", sortable: true },
    { key: "description", kind: "string", sortable: false },
    { key: "namespaces", kind: "number", sortable: true },
    { key: "namespace_id", kind: "number", sortable: true },
    { key: "classes", kind: "number", sortable: true },
    { key: "class_id", kind: "number", sortable: true },
    { key: "json_data", kind: "json", sortable: false },
    { key: "created_at", kind: "date", sortable: true },
    { key: "updated_at", kind: "date", sortable: true },
    { key: "permissions", kind: "array", sortable: false }
  ],
  class_relations: [
    { key: "id", kind: "number", sortable: true },
    { key: "from_classes", kind: "number", sortable: true },
    { key: "to_classes", kind: "number", sortable: true },
    { key: "from_class_name", kind: "string", sortable: false },
    { key: "to_class_name", kind: "string", sortable: false },
    { key: "created_at", kind: "date", sortable: true },
    { key: "updated_at", kind: "date", sortable: true },
    { key: "permissions", kind: "array", sortable: false }
  ],
  object_relations: [
    { key: "id", kind: "number", sortable: true },
    { key: "class_relation", kind: "number", sortable: true },
    { key: "from_objects", kind: "number", sortable: true },
    { key: "to_objects", kind: "number", sortable: true },
    { key: "created_at", kind: "date", sortable: true },
    { key: "updated_at", kind: "date", sortable: true },
    { key: "permissions", kind: "array", sortable: false }
  ],
  related_objects: [
    { key: "id", kind: "number", sortable: true },
    { key: "name", kind: "string", sortable: true },
    { key: "description", kind: "string", sortable: true },
    { key: "namespace_id", kind: "number", sortable: true },
    { key: "namespaces", kind: "number", sortable: true },
    { key: "class_id", kind: "number", sortable: true },
    { key: "classes", kind: "number", sortable: true },
    { key: "created_at", kind: "date", sortable: true },
    { key: "updated_at", kind: "date", sortable: true },
    { key: "from_objects", kind: "number", sortable: true },
    { key: "to_objects", kind: "number", sortable: true },
    { key: "from_classes", kind: "number", sortable: true },
    { key: "to_classes", kind: "number", sortable: true },
    { key: "from_namespaces", kind: "number", sortable: true },
    { key: "to_namespaces", kind: "number", sortable: true },
    { key: "from_name", kind: "string", sortable: true },
    { key: "to_name", kind: "string", sortable: true },
    { key: "from_description", kind: "string", sortable: true },
    { key: "to_description", kind: "string", sortable: true },
    { key: "from_created_at", kind: "date", sortable: true },
    { key: "to_created_at", kind: "date", sortable: true },
    { key: "from_updated_at", kind: "date", sortable: true },
    { key: "to_updated_at", kind: "date", sortable: true },
    { key: "from_json_data", kind: "json", sortable: false },
    { key: "to_json_data", kind: "json", sortable: false },
    { key: "depth", kind: "number", sortable: true },
    { key: "path", kind: "array", sortable: true }
  ]
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function createBuilderId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOperatorsForField(kind: QueryFieldKind): readonly string[] {
  if (kind === "number" || kind === "date") {
    return NUMBER_OPERATORS;
  }
  if (kind === "boolean") {
    return BOOLEAN_OPERATORS;
  }
  if (kind === "array") {
    return ARRAY_OPERATORS;
  }
  if (kind === "json") {
    return JSON_OPERATORS;
  }
  return STRING_OPERATORS;
}

function buildTemplateEditorState(template?: ReportTemplate | null): TemplateEditorState {
  if (!template) {
    return DEFAULT_TEMPLATE_EDITOR;
  }

  return {
    mode: "edit",
    templateId: template.id,
    namespaceId: String(template.namespace_id),
    name: template.name,
    description: template.description,
    contentType: template.content_type === "application/json" ? "text/plain" : template.content_type,
    templateBody: template.template
  };
}

function buildQueryString(filters: QueryBuilderFilter[], sorts: QueryBuilderSort[], advancedQueryText: string): string {
  const params = new URLSearchParams();

  filters.forEach((filter) => {
    if (!filter.field || !filter.value.trim()) {
      return;
    }

    const key = filter.operator === "equals" ? filter.field : `${filter.field}__${filter.operator}`;
    params.append(key, filter.value.trim());
  });

  const sortValue = sorts
    .filter((sort) => sort.field)
    .map((sort) => `${sort.field}.${sort.direction}`)
    .join(",");
  if (sortValue) {
    params.set("sort", sortValue);
  }

  const advancedQuery = new URLSearchParams(advancedQueryText.startsWith("?") ? advancedQueryText.slice(1) : advancedQueryText);
  advancedQuery.forEach((value, key) => {
    if (key === "cursor") {
      return;
    }
    params.append(key, value);
  });

  return params.toString();
}

function getByteCount(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function clampTextByBytes(text: string, byteLimit: number): { text: string; byteCount: number; capped: boolean } {
  const bytes = textEncoder.encode(text);
  if (bytes.byteLength <= byteLimit) {
    return {
      text,
      byteCount: bytes.byteLength,
      capped: false
    };
  }

  let end = byteLimit;
  while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }

  return {
    text: textDecoder.decode(bytes.slice(0, end)).trimEnd(),
    byteCount: end,
    capped: true
  };
}

function formatBytes(byteCount: number): string {
  if (byteCount < 1024) {
    return `${byteCount} B`;
  }
  if (byteCount < 1024 * 1024) {
    return `${(byteCount / 1024).toFixed(1)} KiB`;
  }

  return `${(byteCount / (1024 * 1024)).toFixed(2)} MiB`;
}

function getResultText(result: ReportExecutionResult): string {
  if (typeof result.text === "string") {
    return result.text;
  }

  return result.json ? JSON.stringify(result.json, null, 2) : "";
}

function getReportResultView(result: ReportExecutionResult): ReportResultView {
  const fullText = getResultText(result);
  const totalBytes = getByteCount(fullText);
  const preview = clampTextByBytes(fullText, PREVIEW_BYTE_LIMIT);
  const showInlineHtmlPreview =
    result.contentType === "text/html" && !result.truncated && !preview.capped && Boolean(fullText.trim());

  return {
    fullText,
    previewText: preview.text,
    totalBytes,
    previewBytes: preview.byteCount,
    previewCapped: preview.capped,
    canCopyFull: totalBytes <= FULL_COPY_BYTE_LIMIT,
    showInlineHtmlPreview
  };
}

function downloadReportResult(result: ReportExecutionResult, scopeKind: ReportScopeKind, body: string) {
  const extensionByType: Record<ReportContentType, string> = {
    "application/json": "json",
    "text/plain": "txt",
    "text/html": "html",
    "text/csv": "csv"
  };
  const mimeType = result.contentType === "application/json" ? "application/json;charset=utf-8" : `${result.contentType};charset=utf-8`;
  const blob = new Blob([body], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  anchor.href = url;
  anchor.download = `report-${scopeKind}-${timestamp}.${extensionByType[result.contentType]}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function fetchNamespaces(): Promise<Namespace[]> {
  const response = await getApiV1Namespaces(undefined, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespaces."));
  }

  return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
  const response = await getApiV1Classes(undefined, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
  }

  return response.data;
}

async function fetchObjectsByClass(classId: number): Promise<HubuumObject[]> {
  const response = await getApiV1ClassesByClassIdTrailing(classId, undefined, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load objects."));
  }

  return Array.isArray(response.data) ? (response.data as HubuumObject[]) : [];
}

export function ReportsWorkspace() {
  const queryClient = useQueryClient();
  const [editorState, setEditorState] = useState<TemplateEditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [outputMode, setOutputMode] = useState<"json" | "template">("json");
  const [scopeKind, setScopeKind] = useState<ReportScopeKind>("namespaces");
  const [classId, setClassId] = useState("");
  const [objectId, setObjectId] = useState("");
  const [advancedQueryText, setAdvancedQueryText] = useState("");
  const [missingDataPolicy, setMissingDataPolicy] = useState<ReportMissingDataPolicy>("strict");
  const [maxItems, setMaxItems] = useState("100");
  const [maxOutputBytes, setMaxOutputBytes] = useState("262144");
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ReportExecutionResult | null>(null);
  const [resultActionFeedback, setResultActionFeedback] = useState<ResultActionFeedback>(null);
  const [builderFilters, setBuilderFilters] = useState<QueryBuilderFilter[]>([]);
  const [builderSorts, setBuilderSorts] = useState<QueryBuilderSort[]>([]);

  const templatesQuery = useInfiniteQuery({
    queryKey: ["report-templates"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listReportTemplates(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", "reports"],
    queryFn: fetchNamespaces
  });
  const classesQuery = useQuery({
    queryKey: ["classes", "reports"],
    queryFn: fetchClasses
  });
  const parsedClassId = useMemo(() => parsePositiveInteger(classId), [classId]);
  const objectsQuery = useQuery({
    queryKey: ["report-objects", parsedClassId],
    queryFn: () => fetchObjectsByClass(parsedClassId ?? 0),
    enabled: parsedClassId !== null
  });

  const templates = useMemo(
    () => templatesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [templatesQuery.data?.pages]
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => String(template.id) === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );
  const scopeFields = useMemo(() => SCOPE_QUERY_FIELDS[scopeKind], [scopeKind]);
  const sortFields = useMemo(() => scopeFields.filter((field) => field.sortable), [scopeFields]);
  const builtQuery = useMemo(
    () => buildQueryString(builderFilters, builderSorts, advancedQueryText),
    [advancedQueryText, builderFilters, builderSorts]
  );
  const lastResultView = useMemo(() => (lastResult ? getReportResultView(lastResult) : null), [lastResult]);

  useEffect(() => {
    if (!selectedTemplateId) {
      return;
    }

    if (!templates.some((template) => String(template.id) === selectedTemplateId)) {
      setSelectedTemplateId("");
      setOutputMode("json");
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    const allowedFields = new Set(scopeFields.map((field) => field.key));
    const allowedSortFields = new Set(sortFields.map((field) => field.key));

    setBuilderFilters((current) => current.filter((filter) => allowedFields.has(filter.field)));
    setBuilderSorts((current) => current.filter((sort) => allowedSortFields.has(sort.field)));
  }, [scopeFields, sortFields]);

  const saveTemplateMutation = useMutation({
    mutationFn: async (draft: TemplateEditorState) => {
      const namespaceId = parsePositiveInteger(draft.namespaceId);
      if (!namespaceId) {
        throw new Error("Namespace is required.");
      }
      if (!draft.name.trim()) {
        throw new Error("Name is required.");
      }
      if (!draft.description.trim()) {
        throw new Error("Description is required.");
      }
      if (!draft.templateBody.trim()) {
        throw new Error("Template body is required.");
      }

      if (draft.mode === "create") {
        const payload: NewReportTemplate = {
          namespace_id: namespaceId,
          name: draft.name.trim(),
          description: draft.description.trim(),
          content_type: draft.contentType,
          template: draft.templateBody
        };
        return createReportTemplate(payload);
      }

      if (!draft.templateId) {
        throw new Error("Template id is missing.");
      }

      const payload: UpdateReportTemplate = {
        namespace_id: namespaceId,
        name: draft.name.trim(),
        description: draft.description.trim(),
        template: draft.templateBody
      };
      return updateReportTemplate(draft.templateId, payload);
    },
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ["report-templates"] });
      setSelectedTemplateId(String(template.id));
      setOutputMode("template");
      setEditorState(null);
      setEditorError(null);
    },
    onError: (error) => {
      setEditorError(error instanceof Error ? error.message : "Failed to save report template.");
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: deleteReportTemplate,
    onSuccess: async (_, templateId) => {
      await queryClient.invalidateQueries({ queryKey: ["report-templates"] });
      if (selectedTemplateId === String(templateId)) {
        setSelectedTemplateId("");
        setOutputMode("json");
      }
    }
  });

  const runReportMutation = useMutation({
    mutationFn: async (request: { body: ReportRequest; accept: ReportContentType }) => runReport(request.body, request.accept),
    onSuccess: (result) => {
      setRunnerError(null);
      setLastResult(result);
      setResultActionFeedback(null);
    },
    onError: (error) => {
      setLastResult(null);
      setResultActionFeedback(null);
      setRunnerError(error instanceof Error ? error.message : "Failed to run report.");
    }
  });

  function openCreateModal() {
    setEditorState({
      ...DEFAULT_TEMPLATE_EDITOR,
      namespaceId: namespacesQuery.data?.length ? String(namespacesQuery.data[0].id) : ""
    });
    setEditorError(null);
  }

  function openEditModal(template: ReportTemplate) {
    setEditorState(buildTemplateEditorState(template));
    setEditorError(null);
  }

  function closeEditor() {
    setEditorState(null);
    setEditorError(null);
  }

  function addFilter() {
    const firstField = scopeFields[0];
    if (!firstField) {
      return;
    }

    setBuilderFilters((current) => [
      ...current,
      {
        id: createBuilderId(),
        field: firstField.key,
        operator: getOperatorsForField(firstField.kind)[0],
        value: ""
      }
    ]);
  }

  function addSort() {
    const firstField = sortFields[0];
    if (!firstField) {
      return;
    }

    setBuilderSorts((current) => [
      ...current,
      {
        id: createBuilderId(),
        field: firstField.key,
        direction: "asc"
      }
    ]);
  }

  function handleRunReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope: ReportRequest["scope"] = {
      kind: scopeKind
    };

    if (scopeKind === "objects_in_class" || scopeKind === "related_objects") {
      const parsed = parsePositiveInteger(classId);
      if (!parsed) {
        setRunnerError("Class is required for the selected scope.");
        return;
      }
      scope.class_id = parsed;
    }

    if (scopeKind === "related_objects") {
      const parsed = parsePositiveInteger(objectId);
      if (!parsed) {
        setRunnerError("Object is required for the selected scope.");
        return;
      }
      scope.object_id = parsed;
    }

    let accept: ReportContentType = "application/json";
    let output: ReportRequest["output"] = null;
    if (outputMode === "template") {
      if (!selectedTemplate) {
        setRunnerError("Select a stored template to run a text report.");
        return;
      }
      accept = selectedTemplate.content_type;
      output = {
        template_id: selectedTemplate.id
      };
    }

    setRunnerError(null);
    setResultActionFeedback(null);
    runReportMutation.mutate({
      accept,
      body: {
        scope,
        query: builtQuery || null,
        output,
        missing_data_policy: missingDataPolicy,
        limits: {
          max_items: parsePositiveInteger(maxItems),
          max_output_bytes: parsePositiveInteger(maxOutputBytes)
        }
      }
    });
  }

  async function copyReportText(text: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }

      await navigator.clipboard.writeText(text);
      setResultActionFeedback({
        tone: "success",
        message: `${label} copied to the clipboard.`
      });
    } catch (error) {
      setResultActionFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : `Failed to copy ${label.toLowerCase()}.`
      });
    }
  }

  const namespaceOptions = namespacesQuery.data ?? [];
  const classOptions = classesQuery.data ?? [];
  const objectOptions = objectsQuery.data ?? [];

  return (
    <section className="stack">
      <header className="stack action-card-header">
        <div className="stack action-card-header">
          <p className="eyebrow">Reports</p>
          <h2>Templates and report runner</h2>
        </div>
        <p className="muted">
          Manage stored templates, then run server-side reports as JSON, plain text, HTML, or CSV.
        </p>
      </header>

      <div className="reports-layout">
        <section className="stack">
          <article className="card stack panel-card">
            <div className="panel-header">
              <div className="stack action-card-header">
                <h3>Template library</h3>
                <p className="muted">Stored templates are namespace-scoped and control text output format.</p>
              </div>
              <button type="button" onClick={openCreateModal}>
                Create template
              </button>
            </div>

            {templatesQuery.isLoading ? <div className="muted">Loading templates...</div> : null}
            {templatesQuery.isError ? (
              <div className="error-banner">
                Failed to load templates. {templatesQuery.error instanceof Error ? templatesQuery.error.message : "Unknown error"}
              </div>
            ) : null}
            {!templatesQuery.isLoading && !templates.length ? (
              <div className="empty-state">No report templates available yet.</div>
            ) : null}

            <div className="template-list">
              {templates.map((template) => (
                <article
                  key={template.id}
                  className={`template-card ${selectedTemplateId === String(template.id) ? "template-card--selected" : ""}`}
                >
                  <div className="template-card-header">
                    <div>
                      <h4>{template.name}</h4>
                      <p className="muted">
                        Namespace #{template.namespace_id} · {template.content_type}
                      </p>
                    </div>
                    <span className="template-stamp">Updated {formatTimestamp(template.updated_at)}</span>
                  </div>
                  <p className="template-description">{template.description}</p>
                  <pre className="template-snippet template-snippet--compact">{template.template}</pre>
                  <div className="action-row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setSelectedTemplateId(String(template.id));
                        setOutputMode("template");
                      }}
                    >
                      Use in runner
                    </button>
                    <button type="button" className="ghost" onClick={() => openEditModal(template)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (!window.confirm(`Delete template "${template.name}"?`)) {
                          return;
                        }
                        deleteTemplateMutation.mutate(template.id);
                      }}
                      disabled={deleteTemplateMutation.isPending}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {templatesQuery.hasNextPage ? (
              <button
                type="button"
                className="ghost"
                onClick={() => templatesQuery.fetchNextPage()}
                disabled={templatesQuery.isFetchingNextPage}
              >
                {templatesQuery.isFetchingNextPage ? "Loading more..." : "Load more templates"}
              </button>
            ) : null}
          </article>
        </section>

        <section className="stack">
          <article className="card stack panel-card">
            <div className="stack action-card-header">
              <h3>Report runner</h3>
              <p className="muted">Build a scope-aware query, then return JSON or render a stored template.</p>
            </div>

            <form className="stack" onSubmit={handleRunReport}>
              <div className="form-grid">
                <label className="control-field">
                  <span>Scope</span>
                  <select value={scopeKind} onChange={(event) => setScopeKind(event.target.value as ReportScopeKind)}>
                    <option value="namespaces">Namespaces</option>
                    <option value="classes">Classes</option>
                    <option value="objects_in_class">Objects in class</option>
                    <option value="class_relations">Class relations</option>
                    <option value="object_relations">Object relations</option>
                    <option value="related_objects">Related objects</option>
                  </select>
                </label>

                <label className="control-field">
                  <span>Output mode</span>
                  <select value={outputMode} onChange={(event) => setOutputMode(event.target.value as "json" | "template")}>
                    <option value="json">JSON</option>
                    <option value="template">Stored template</option>
                  </select>
                </label>

                {scopeKind === "objects_in_class" || scopeKind === "related_objects" ? (
                  <div className="control-field">
                    <label htmlFor="report-class">Class</label>
                    {classOptions.length > 0 ? (
                      <select id="report-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
                        <option value="">Select class</option>
                        {classOptions.map((classItem) => (
                          <option key={classItem.id} value={classItem.id}>
                            {classItem.name} (#{classItem.id})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="report-class"
                        type="number"
                        min={1}
                        value={classId}
                        onChange={(event) => setClassId(event.target.value)}
                        placeholder="Enter class ID"
                      />
                    )}
                  </div>
                ) : null}

                {scopeKind === "related_objects" ? (
                  <div className="control-field">
                    <label htmlFor="report-object">Object</label>
                    {objectOptions.length > 0 ? (
                      <select id="report-object" value={objectId} onChange={(event) => setObjectId(event.target.value)}>
                        <option value="">Select object</option>
                        {objectOptions.map((objectItem) => (
                          <option key={objectItem.id} value={objectItem.id}>
                            {objectItem.name} (#{objectItem.id})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="report-object"
                        type="number"
                        min={1}
                        value={objectId}
                        onChange={(event) => setObjectId(event.target.value)}
                        placeholder="Enter object ID"
                      />
                    )}
                  </div>
                ) : null}

                {outputMode === "template" ? (
                  <label className="control-field control-field--wide">
                    <span>Stored template</span>
                    <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                      <option value="">Select template</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} ({template.content_type})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="query-builder-card control-field--wide">
                  <div className="panel-header">
                    <div className="stack action-card-header">
                      <h4>Query builder</h4>
                      <p className="muted">Available fields in the selectors below are limited to the current scope.</p>
                    </div>
                    <div className="action-row">
                      <button type="button" className="ghost" onClick={addFilter}>
                        Add filter
                      </button>
                      <button type="button" className="ghost" onClick={addSort}>
                        Add sort
                      </button>
                    </div>
                  </div>

                  {builderFilters.length ? (
                    <div className="stack">
                      {builderFilters.map((filter) => {
                        const fieldDefinition = scopeFields.find((field) => field.key === filter.field) ?? scopeFields[0];
                        const operatorOptions = getOperatorsForField(fieldDefinition.kind);

                        return (
                          <div key={filter.id} className="query-row">
                            <select
                              value={filter.field}
                              onChange={(event) => {
                                const nextField = scopeFields.find((field) => field.key === event.target.value) ?? scopeFields[0];
                                setBuilderFilters((current) =>
                                  current.map((currentFilter) =>
                                    currentFilter.id === filter.id
                                      ? {
                                          ...currentFilter,
                                          field: nextField.key,
                                          operator: getOperatorsForField(nextField.kind)[0]
                                        }
                                      : currentFilter
                                  )
                                );
                              }}
                            >
                              {scopeFields.map((field) => (
                                <option key={field.key} value={field.key}>
                                  {field.key}
                                </option>
                              ))}
                            </select>
                            <select
                              value={filter.operator}
                              onChange={(event) =>
                                setBuilderFilters((current) =>
                                  current.map((currentFilter) =>
                                    currentFilter.id === filter.id
                                      ? { ...currentFilter, operator: event.target.value }
                                      : currentFilter
                                  )
                                )
                              }
                            >
                              {operatorOptions.map((operator) => (
                                <option key={operator} value={operator}>
                                  {operator}
                                </option>
                              ))}
                            </select>
                            <input
                              value={filter.value}
                              onChange={(event) =>
                                setBuilderFilters((current) =>
                                  current.map((currentFilter) =>
                                    currentFilter.id === filter.id
                                      ? { ...currentFilter, value: event.target.value }
                                      : currentFilter
                                  )
                                )
                              }
                              placeholder={filter.operator === "between" ? "min,max" : "value"}
                            />
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                setBuilderFilters((current) => current.filter((currentFilter) => currentFilter.id !== filter.id))
                              }
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-state">No filters yet. Add a filter or use the advanced query input.</div>
                  )}

                  {builderSorts.length ? (
                    <div className="stack">
                      {builderSorts.map((sort) => (
                        <div key={sort.id} className="query-row">
                          <select
                            value={sort.field}
                            onChange={(event) =>
                              setBuilderSorts((current) =>
                                current.map((currentSort) =>
                                  currentSort.id === sort.id ? { ...currentSort, field: event.target.value } : currentSort
                                )
                              )
                            }
                          >
                            {sortFields.map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.key}
                              </option>
                            ))}
                          </select>
                          <select
                            value={sort.direction}
                            onChange={(event) =>
                              setBuilderSorts((current) =>
                                current.map((currentSort) =>
                                  currentSort.id === sort.id
                                    ? { ...currentSort, direction: event.target.value as "asc" | "desc" }
                                    : currentSort
                                )
                              )
                            }
                          >
                            <option value="asc">asc</option>
                            <option value="desc">desc</option>
                          </select>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setBuilderSorts((current) => current.filter((currentSort) => currentSort.id !== sort.id))}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <label className="control-field control-field--wide">
                    <span>Advanced query additions</span>
                    <textarea
                      value={advancedQueryText}
                      onChange={(event) => setAdvancedQueryText(event.target.value)}
                      placeholder="permissions__contains=ReadClass&created_at__gte=2026-03-01T00:00:00Z"
                    />
                  </label>

                  <label className="control-field control-field--wide">
                    <span>Generated query string</span>
                    <textarea value={builtQuery} readOnly placeholder="Query string will appear here." />
                  </label>
                </div>

                <label className="control-field">
                  <span>Missing data policy</span>
                  <select
                    value={missingDataPolicy}
                    onChange={(event) => setMissingDataPolicy(event.target.value as ReportMissingDataPolicy)}
                  >
                    <option value="strict">Strict</option>
                    <option value="null">Null</option>
                    <option value="omit">Omit</option>
                  </select>
                </label>

                <label className="control-field">
                  <span>Max items</span>
                  <input type="number" min={1} value={maxItems} onChange={(event) => setMaxItems(event.target.value)} />
                </label>

                <label className="control-field">
                  <span>Max output bytes</span>
                  <input
                    type="number"
                    min={1}
                    value={maxOutputBytes}
                    onChange={(event) => setMaxOutputBytes(event.target.value)}
                  />
                </label>
              </div>

              {runnerError ? <div className="error-banner">{runnerError}</div> : null}

              <div className="action-row">
                <button type="submit" disabled={runReportMutation.isPending}>
                  {runReportMutation.isPending ? "Running..." : "Run report"}
                </button>
                {selectedTemplate ? <span className="muted">Template output type: {selectedTemplate.content_type}</span> : null}
              </div>
            </form>
          </article>

          <article className="card stack panel-card">
            <div className="panel-header">
              <div className="stack action-card-header">
                <h3>Result console</h3>
                <p className="muted">Large responses stay manageable here: scan the metadata first, then preview, copy, or download deliberately.</p>
              </div>
            </div>

            {!lastResult ? <div className="empty-state">Run a report to inspect the response.</div> : null}
            {lastResult && lastResultView ? (
              <div className="stack">
                <div className="result-toolbar">
                  <div className="preview-meta">
                    <span>{lastResult.contentType}</span>
                    <span>{formatBytes(lastResultView.totalBytes)}</span>
                    <span>{lastResult.warningCount} warning(s)</span>
                    <span>{lastResult.truncated ? "Truncated by backend" : "Backend complete"}</span>
                    <span>{lastResultView.previewCapped ? `Preview capped at ${formatBytes(PREVIEW_BYTE_LIMIT)}` : "Full preview"}</span>
                  </div>

                  <div className="action-row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => downloadReportResult(lastResult, scopeKind, lastResultView.fullText)}
                    >
                      Download full result
                    </button>
                    {lastResult.contentType !== "text/html" || lastResultView.showInlineHtmlPreview ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => copyReportText(lastResultView.previewText, "Preview")}
                        disabled={!lastResultView.previewText}
                      >
                        Copy preview
                      </button>
                    ) : null}
                    {lastResult.contentType !== "text/html" || lastResultView.showInlineHtmlPreview ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => copyReportText(lastResultView.fullText, "Full result")}
                        disabled={!lastResultView.canCopyFull}
                      >
                        Copy full result
                      </button>
                    ) : null}
                  </div>
                </div>

                {!lastResultView.canCopyFull ? (
                  <div className="muted">
                    Full copy is disabled above {formatBytes(FULL_COPY_BYTE_LIMIT)}. Download the full result instead.
                  </div>
                ) : null}

                {resultActionFeedback ? (
                  <div className={resultActionFeedback.tone === "danger" ? "error-banner" : "info-banner"}>
                    {resultActionFeedback.message}
                  </div>
                ) : null}

                {lastResult.contentType === "text/html" && !lastResultView.showInlineHtmlPreview ? (
                  <div className="empty-state">
                    HTML preview is hidden for large or incomplete output. Download the full result to inspect it safely.
                  </div>
                ) : null}

                {lastResultView.previewCapped && lastResult.contentType !== "text/html" ? (
                  <div className="empty-state">
                    This inline preview only shows the first {formatBytes(lastResultView.previewBytes)}. Use download for the full payload.
                  </div>
                ) : null}

                {(lastResult.contentType === "application/json" ||
                  lastResult.contentType === "text/plain" ||
                  lastResult.contentType === "text/csv") &&
                lastResultView.previewText ? (
                  <pre className="response-preview">{lastResultView.previewText}</pre>
                ) : null}

                {lastResult.contentType === "text/html" && lastResultView.showInlineHtmlPreview ? (
                  <iframe className="html-preview" sandbox="" srcDoc={lastResultView.fullText} title="Report HTML preview" />
                ) : null}
              </div>
            ) : null}
          </article>
        </section>
      </div>

      <CreateModal
        open={editorState !== null}
        title={editorState?.mode === "edit" ? "Edit report template" : "Create report template"}
        onClose={closeEditor}
      >
        {editorState ? (
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            setEditorError(null);
            saveTemplateMutation.mutate(editorState);
          }}>
            <div className="form-grid">
              <div className="control-field">
                <label htmlFor="report-template-namespace">Namespace</label>
                {namespaceOptions.length > 0 ? (
                  <select
                    id="report-template-namespace"
                    value={editorState.namespaceId}
                    onChange={(event) => setEditorState({ ...editorState, namespaceId: event.target.value })}
                  >
                    {namespaceOptions.map((namespace) => (
                      <option key={namespace.id} value={namespace.id}>
                        {namespace.name} (#{namespace.id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="report-template-namespace"
                    type="number"
                    min={1}
                    value={editorState.namespaceId}
                    onChange={(event) => setEditorState({ ...editorState, namespaceId: event.target.value })}
                    placeholder="Enter namespace ID"
                  />
                )}
              </div>

              <label className="control-field">
                <span>Name</span>
                <input value={editorState.name} onChange={(event) => setEditorState({ ...editorState, name: event.target.value })} required />
              </label>

              <label className="control-field control-field--wide">
                <span>Description</span>
                <input
                  value={editorState.description}
                  onChange={(event) => setEditorState({ ...editorState, description: event.target.value })}
                  required
                />
              </label>

              {editorState.mode === "create" ? (
                <label className="control-field">
                  <span>Content type</span>
                  <select
                    value={editorState.contentType}
                    onChange={(event) =>
                      setEditorState({
                        ...editorState,
                        contentType: event.target.value as StoredReportContentType
                      })
                    }
                  >
                    <option value="text/plain">text/plain</option>
                    <option value="text/html">text/html</option>
                    <option value="text/csv">text/csv</option>
                  </select>
                </label>
              ) : (
                <label className="control-field">
                  <span>Content type</span>
                  <input value={editorState.contentType} readOnly />
                </label>
              )}
            </div>

            <TemplateCodeEditor
              label="Template body"
              value={editorState.templateBody}
              onChange={(templateBody) => setEditorState({ ...editorState, templateBody })}
              placeholder="{{#each items}}{{this.name}}\n{{/each}}"
              disabled={saveTemplateMutation.isPending}
            />

            <div className="template-help">
              {TEMPLATE_HELP.map((item) => (
                <p key={item} className="muted">
                  {item}
                </p>
              ))}
            </div>

            {editorError ? <div className="error-banner">{editorError}</div> : null}

            <div className="action-row">
              <button type="submit" disabled={saveTemplateMutation.isPending}>
                {saveTemplateMutation.isPending
                  ? editorState.mode === "edit"
                    ? "Saving..."
                    : "Creating..."
                  : editorState.mode === "edit"
                    ? "Save template"
                    : "Create template"}
              </button>
              <button type="button" className="ghost" onClick={closeEditor} disabled={saveTemplateMutation.isPending}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </CreateModal>
    </section>
  );
}
