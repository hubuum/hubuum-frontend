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

async function fetchNamespaces(): Promise<Namespace[]> {
  const response = await getApiV1Namespaces({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespaces."));
  }

  return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
  const response = await getApiV1Classes({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
  }

  return response.data;
}

async function fetchObjectsByClass(classId: number): Promise<HubuumObject[]> {
  const response = await getApiV1ClassesByClassIdTrailing(classId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load objects."));
  }

  return Array.isArray(response.data) ? (response.data as HubuumObject[]) : [];
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    contentType: template.content_type,
    templateBody: template.template
  };
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
  const [queryText, setQueryText] = useState("");
  const [missingDataPolicy, setMissingDataPolicy] = useState<ReportMissingDataPolicy>("strict");
  const [maxItems, setMaxItems] = useState("100");
  const [maxOutputBytes, setMaxOutputBytes] = useState("262144");
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ReportExecutionResult | null>(null);

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

  useEffect(() => {
    if (!selectedTemplateId) {
      return;
    }

    const exists = templates.some((template) => String(template.id) === selectedTemplateId);
    if (!exists) {
      setSelectedTemplateId("");
      setOutputMode("json");
    }
  }, [selectedTemplateId, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => String(template.id) === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );

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
    },
    onError: (error) => {
      setLastResult(null);
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

  function handleEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editorState) {
      return;
    }

    setEditorError(null);
    saveTemplateMutation.mutate(editorState);
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
    runReportMutation.mutate({
      accept,
      body: {
        scope,
        query: queryText.trim() || null,
        output,
        missing_data_policy: missingDataPolicy,
        limits: {
          max_items: parsePositiveInteger(maxItems),
          max_output_bytes: parsePositiveInteger(maxOutputBytes)
        }
      }
    });
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

            <div className="template-help">
              {TEMPLATE_HELP.map((item) => (
                <p key={item} className="muted">
                  {item}
                </p>
              ))}
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
                <article key={template.id} className="template-card">
                  <div className="template-card-header">
                    <div>
                      <h4>{template.name}</h4>
                      <p className="muted">
                        Namespace #{template.namespace_id} · {template.content_type}
                      </p>
                    </div>
                    <span className="template-stamp">Updated {formatTimestamp(template.updated_at)}</span>
                  </div>
                  <p>{template.description}</p>
                  <pre className="template-snippet">{template.template}</pre>
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
              <p className="muted">Choose a scope and either return JSON or render a stored template.</p>
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

                <label className="control-field control-field--wide">
                  <span>Query string</span>
                  <input
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    placeholder="name__contains=server&sort=name"
                  />
                </label>

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
                <h3>Report preview</h3>
                <p className="muted">JSON stays structured. HTML is isolated in a sandboxed iframe.</p>
              </div>
              {lastResult ? (
                <div className="preview-meta">
                  <span>{lastResult.contentType}</span>
                  <span>{lastResult.warningCount} warning(s)</span>
                  <span>{lastResult.truncated ? "Truncated" : "Complete"}</span>
                </div>
              ) : null}
            </div>

            {!lastResult ? <div className="empty-state">Run a report to inspect the response.</div> : null}
            {lastResult?.contentType === "application/json" ? (
              <pre className="response-preview">{JSON.stringify(lastResult.json, null, 2)}</pre>
            ) : null}
            {lastResult?.contentType === "text/plain" || lastResult?.contentType === "text/csv" ? (
              <pre className="response-preview">{lastResult.text}</pre>
            ) : null}
            {lastResult?.contentType === "text/html" ? (
              <iframe className="html-preview" sandbox="" srcDoc={lastResult.text ?? ""} title="Report HTML preview" />
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
          <form className="stack" onSubmit={handleEditorSubmit}>
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
