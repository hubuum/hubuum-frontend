"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { IncludeRows } from "@/components/include-rows";
import { ReportQueryBuilder } from "@/components/report-query-builder";
import { TemplateCodeEditor } from "@/components/template-code-editor";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1Classes,
	getApiV1Collections,
} from "@/lib/api/generated/client";
import type {
	Collection,
	HubuumClassExpanded,
	HubuumObject,
} from "@/lib/api/generated/models";
import {
	createReportTemplate,
	fetchReportOutput,
	fetchReportTask,
	getReportTemplate,
	listReportTemplateHistory,
	listReportTemplates,
	type NewReportTemplate,
	type ReportExecutionResult,
	type ReportTemplate,
	type ReportTemplateHistory,
	type StoredReportContentType,
	type TaskResponse,
	type UpdateReportTemplate,
	runTemplateReport,
	updateReportTemplate,
} from "@/lib/api/reporting";
import { isTerminalTaskStatus } from "@/lib/api/tasking";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
} from "@/lib/collection-hierarchy";
import {
	filterClassesForCollection,
	getEditorTabForErrors,
	parsePositiveInteger,
	type ExportTemplateDraft,
	type ExportTemplateDraftErrors,
	type ExportTemplateDraftField,
	type ExportTemplateEditorSection,
	validateExportTemplateDraft,
	validateExportTemplateRelated,
	validateExportTemplateRules,
	validateExportTemplateTarget,
} from "@/lib/export-template-editor";
import {
	formatExportContentType,
	formatExportScope,
} from "@/lib/export-workspace";
import {
	discoverJsonFields,
	type DiscoveredJsonField,
} from "@/lib/json-field-discovery";
import {
	buildIncludeFromRows,
	includeAliasesOf,
	includeRowsFromTemplate,
	type IncludeBuilderRow,
	newIncludeRow,
} from "@/lib/report-include";

type TemplateEditorTab = ExportTemplateEditorSection;
type SaveIntent = "save" | "test";

type ExportTemplateEditorProps = {
	templateId?: number;
	initialTestTaskId?: number;
};

type SaveRequest = {
	draft: ExportTemplateDraft;
	intent: SaveIntent;
	testObjectId: string;
	skipSave: boolean;
};

type SaveResult = {
	template: ReportTemplate;
	intent: SaveIntent;
	testTask: TaskResponse | null;
	testError: string | null;
};

const EDITOR_TABS: Array<{
	id: TemplateEditorTab;
	label: string;
	hint: string;
}> = [
	{ id: "target", label: "1. Target", hint: "Collection, scope, and class" },
	{ id: "filters", label: "2. Filters", hint: "Filter and sort defaults" },
	{ id: "related", label: "3. Related", hint: "Includes and hydration" },
	{ id: "rules", label: "4. Rules", hint: "Missing data and limits" },
	{
		id: "appearance",
		label: "5. Appearance",
		hint: "Content and test output",
	},
	{ id: "history", label: "History", hint: "Saved versions" },
];

const TEMPLATE_HELP = [
	"{{ item.name }} interpolates a value; {% for item in items %} ... {% endfor %} loops arrays.",
	"Root context: items, meta.*, warnings, request.*, and source (related_objects).",
	"Relations: item.related.<alias> (includes), item.reachable.*/paths.* (when hydrated) — each is a list.",
	"Helpers: coalesce(...), | tojson, | csv_cell, | default(...), | default_if_empty(...), | format_datetime(...), | join_nonempty(...).",
	"HTML templates are autoescaped; use | tojson or | csv_cell for sensitive values in text/CSV.",
	"include/import/extends resolve within the same collection.",
] as const;

const DEFAULT_TEMPLATE_EDITOR: ExportTemplateDraft = {
	mode: "create",
	templateId: null,
	collectionId: "",
	name: "",
	description: "",
	contentType: "text/plain",
	templateBody: `{% for item in items %}{{ item.name }}
{% endfor %}`,
	kind: "export",
	scopeKind: "objects_in_class",
	classId: "",
	defaultQuery: "",
	includeRows: [],
	depth: "",
	missingDataPolicy: "strict",
	maxItems: "",
	maxOutputBytes: "",
};

const FIELD_LABELS: Record<ExportTemplateDraftField, string> = {
	collectionId: "Collection",
	name: "Name",
	description: "Description",
	templateBody: "Template body",
	classId: "Class",
	depth: "Relation depth",
	maxItems: "Maximum items",
	maxOutputBytes: "Maximum output size",
	includeRows: "Related includes",
};

const FIELD_IDS: Record<ExportTemplateDraftField, string> = {
	collectionId: "export-template-collection",
	name: "export-template-name",
	description: "export-template-description",
	templateBody: "export-template-body",
	classId: "export-template-class",
	depth: "export-template-depth",
	maxItems: "export-template-max-items",
	maxOutputBytes: "export-template-max-output",
	includeRows: "export-template-includes",
};

function createBuilderId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(byteCount: number): string {
	if (byteCount < 1024) return `${byteCount} B`;
	if (byteCount < 1024 * 1024) return `${(byteCount / 1024).toFixed(1)} KiB`;
	return `${(byteCount / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatTimestamp(value: string | null | undefined): string {
	if (!value) return "Unknown time";
	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

function getResultText(result: ReportExecutionResult): string {
	if (typeof result.text === "string") return result.text;
	return result.json ? JSON.stringify(result.json, null, 2) : "";
}

function getTaskStatusTone(
	status: TaskResponse["status"],
): "neutral" | "success" | "danger" | "accent" {
	if (status === "succeeded") return "success";
	if (status === "failed" || status === "cancelled") return "danger";
	if (status === "partially_succeeded") return "accent";
	return "neutral";
}

function getTaskProgress(task: TaskResponse | null): number {
	if (!task) return 0;
	if (isTerminalTaskStatus(task.status)) return 100;
	if (task.progress.total_items < 1) return 0;
	return Math.min(
		100,
		Math.round(
			(task.progress.processed_items / task.progress.total_items) * 100,
		),
	);
}

function buildTemplateEditorState(
	template: ReportTemplate,
): ExportTemplateDraft {
	return {
		mode: "edit",
		templateId: template.id,
		collectionId: String(template.collection_id),
		name: template.name,
		description: template.description,
		contentType:
			template.content_type === "application/json"
				? "text/plain"
				: template.content_type,
		templateBody: template.template,
		kind: template.kind,
		scopeKind: template.scope_kind ?? "objects_in_class",
		classId: template.class_id != null ? String(template.class_id) : "",
		defaultQuery: template.default_query ?? "",
		includeRows: includeRowsFromTemplate(template.include, createBuilderId),
		depth:
			template.relation_context?.depth != null
				? String(template.relation_context.depth)
				: "",
		missingDataPolicy: template.default_missing_data_policy ?? "strict",
		maxItems:
			template.default_limits?.max_items != null
				? String(template.default_limits.max_items)
				: "",
		maxOutputBytes:
			template.default_limits?.max_output_bytes != null
				? String(template.default_limits.max_output_bytes)
				: "",
	};
}

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections(
		{ include_total: false, limit: 250 },
		{ credentials: "include" },
	);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}
	return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ include_total: false, limit: 250 },
		{ credentials: "include" },
	);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}
	return response.data;
}

async function fetchClassObjectSamples(
	classId: number,
): Promise<HubuumObject[]> {
	const params = new URLSearchParams({
		include_total: "false",
		limit: "100",
		sort: "id.asc",
	});
	const response = await fetch(
		`/_hubuum-bff/classes/${classId}/objects?${params.toString()}`,
		{ credentials: "include" },
	);
	const payload: unknown = await response.json().catch(() => null);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to inspect objects for data fields."),
		);
	}
	return expectArrayPayload<HubuumObject>(payload, "class object samples");
}

function buildTemplatePayload(draft: ExportTemplateDraft) {
	const collectionId = parsePositiveInteger(draft.collectionId);
	if (!collectionId) throw new Error("Collection is required.");
	const base = {
		collection_id: collectionId,
		name: draft.name.trim(),
		description: draft.description.trim(),
		content_type: draft.contentType,
		template: draft.templateBody,
		kind: draft.kind,
	};

	let reportFields: Partial<NewReportTemplate> = {};
	if (draft.kind === "export") {
		const scopeNeedsClass =
			draft.scopeKind === "objects_in_class" ||
			draft.scopeKind === "related_objects";
		const classId = parsePositiveInteger(draft.classId);
		const builtInclude = scopeNeedsClass
			? buildIncludeFromRows(draft.includeRows)
			: { include: null };
		if ("error" in builtInclude) throw new Error(builtInclude.error);
		const depth = draft.depth.trim() ? parsePositiveInteger(draft.depth) : null;
		const maxItems = draft.maxItems.trim()
			? parsePositiveInteger(draft.maxItems)
			: null;
		const maxOutputBytes = draft.maxOutputBytes.trim()
			? parsePositiveInteger(draft.maxOutputBytes)
			: null;
		reportFields = {
			scope_kind: draft.scopeKind,
			class_id: scopeNeedsClass ? classId : null,
			default_query: draft.defaultQuery.trim() || null,
			include: builtInclude.include,
			relation_context: depth ? { depth } : null,
			default_missing_data_policy: draft.missingDataPolicy,
			default_limits:
				maxItems != null || maxOutputBytes != null
					? { max_items: maxItems, max_output_bytes: maxOutputBytes }
					: null,
		};
	} else if (draft.mode === "edit") {
		reportFields = {
			scope_kind: null,
			class_id: null,
			default_query: null,
			include: null,
			relation_context: null,
			default_missing_data_policy: null,
			default_limits: null,
		};
	}

	return { base, reportFields };
}

function HistoryEntry({ entry }: { entry: ReportTemplateHistory }) {
	return (
		<article className="history-entry-card">
			<div className="history-entry-header">
				<div className="stack action-card-header">
					<strong>{entry.op.replaceAll("_", " ")}</strong>
					<span className="muted">
						{formatTimestamp(entry.valid_from)} ·{" "}
						{entry.actor_username ?? "System"}
					</span>
				</div>
				<span className="template-stamp">Revision #{entry.history_id}</span>
			</div>
			<div className="preview-meta">
				<span>{entry.name}</span>
				<span>{formatExportContentType(entry.content_type)}</span>
				<span>{formatExportScope(entry.scope_kind)}</span>
			</div>
			<details className="export-disclosure">
				<summary>
					<span>View saved content</span>
					<small>{entry.template.length} characters</small>
				</summary>
				<pre className="response-preview export-disclosure-body">
					{entry.template}
				</pre>
			</details>
		</article>
	);
}

function dataFieldDetail(
	field: DiscoveredJsonField,
	sampleCount: number,
): string {
	const types = field.types.length ? field.types.join(" / ") : "unknown";
	if (field.source === "schema") {
		return field.observedIn
			? `${types} · schema · seen in ${field.observedIn} of ${sampleCount}`
			: `${types} · schema`;
	}
	return `${types} · sampled in ${field.observedIn} of ${sampleCount}`;
}

function DataFieldPalette({
	fields,
	sampleCount,
	isLoading,
	error,
	sourceMode,
	onInsert,
	onRefresh,
}: {
	fields: DiscoveredJsonField[];
	sampleCount: number;
	isLoading: boolean;
	error: string | null;
	sourceMode: "schema" | "sample";
	onInsert?: (field: DiscoveredJsonField) => void;
	onRefresh?: () => void;
}) {
	const schemaCount = fields.filter(
		(field) => field.source === "schema",
	).length;
	const sampledCount = fields.length - schemaCount;
	const hasSchemaArrayItems = fields.some(
		(field) => field.source === "schema" && field.label.includes("[]"),
	);

	return (
		<div className="stack template-data-field-palette">
			<div className="template-data-field-status">
				<div className="preview-meta template-data-field-meta" role="status">
					<span>
						{fields.length} field{fields.length === 1 ? "" : "s"}
					</span>
					{schemaCount ? <span>{schemaCount} from schema</span> : null}
					{sampledCount ? <span>{sampledCount} sampled</span> : null}
					<span>
						{sourceMode === "schema"
							? "From class schema"
							: isLoading
								? "Inspecting up to 100 objects…"
								: error
									? "Object sampling unavailable"
									: `${sampleCount} object${sampleCount === 1 ? "" : "s"} inspected`}
					</span>
				</div>
				{sourceMode === "sample" && onRefresh ? (
					<button
						type="button"
						className="ghost compact-button"
						onClick={onRefresh}
						disabled={isLoading}
					>
						{isLoading ? "Refreshing…" : "Refresh fields"}
					</button>
				) : null}
			</div>
			{hasSchemaArrayItems ? (
				<p className="field-note">
					Array item paths use <code>[]</code>. Inserting one starts at{" "}
					<code>[0]</code>; replace it with the index you need, such as{" "}
					<code>[9]</code>. Autocomplete accepts any numeric index.
				</p>
			) : null}
			{error ? (
				<p className="field-note">
					Object sampling was unavailable. Schema fields are still shown when
					available. {error}
				</p>
			) : null}
			{fields.length ? (
				<ul className="template-data-field-list">
					{fields.map((field) => {
						const content = (
							<>
								<code>{field.label}</code>
								<small>{dataFieldDetail(field, sampleCount)}</small>
							</>
						);
						return (
							<li key={field.templateExpression}>
								{onInsert ? (
									<button
										type="button"
										className="template-data-field"
										onClick={() => onInsert(field)}
										title={`Insert {{ ${field.templateExpression} }}`}
									>
										{content}
									</button>
								) : (
									<div className="template-data-field">{content}</div>
								)}
							</li>
						);
					})}
				</ul>
			) : isLoading ? (
				<div className="muted">Looking for JSON data fields…</div>
			) : error ? (
				<div className="empty-state">
					The schema has no discoverable fields, and object data could not be
					inspected.
				</div>
			) : (
				<div className="empty-state">
					No JSON fields were found in the class schema or sampled objects.
				</div>
			)}
		</div>
	);
}

function WorkflowContinueBar({
	title,
	summary,
	nextLabel,
	onContinue,
}: {
	title: string;
	summary: string;
	nextLabel: string;
	onContinue: () => void;
}) {
	return (
		<div className="card export-target-continue-bar">
			<div className="stack action-card-header">
				<strong>{title}</strong>
				<span className="muted">{summary}</span>
			</div>
			<button type="button" onClick={onContinue}>
				Continue to {nextLabel.toLocaleLowerCase()}
			</button>
		</div>
	);
}

export function ExportTemplateEditor({
	templateId,
	initialTestTaskId,
}: ExportTemplateEditorProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<TemplateEditorTab>(
		templateId == null ? "target" : "appearance",
	);
	const [editorState, setEditorState] = useState<ExportTemplateDraft>({
		...DEFAULT_TEMPLATE_EDITOR,
		mode: templateId == null ? "create" : "edit",
		templateId: templateId ?? null,
	});
	const [fieldErrors, setFieldErrors] = useState<ExportTemplateDraftErrors>({});
	const [editorError, setEditorError] = useState<string | null>(null);
	const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
	const [testObjectId, setTestObjectId] = useState("");
	const [testObjectError, setTestObjectError] = useState<string | null>(null);
	const [testTaskId, setTestTaskId] = useState<number | null>(
		initialTestTaskId ?? null,
	);
	const [insertRequest, setInsertRequest] = useState<{
		id: number;
		text: string;
	} | null>(null);
	const insertRequestIdRef = useRef(1);
	const initialSnapshotRef = useRef(JSON.stringify(editorState));
	const loadedTemplateIdRef = useRef<number | null>(null);
	const scopeNeedsClass =
		editorState.scopeKind === "objects_in_class" ||
		editorState.scopeKind === "related_objects";

	const collectionsQuery = useQuery({
		queryKey: ["collections", "export-template-editor"],
		queryFn: fetchCollections,
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "export-template-editor"],
		queryFn: fetchClasses,
	});
	const templatesQuery = useQuery({
		queryKey: ["export-templates", "editor-reference"],
		queryFn: () => listReportTemplates(),
	});
	const templateQuery = useQuery({
		queryKey: ["export-template", templateId ?? null],
		queryFn: () => getReportTemplate(templateId ?? 0),
		enabled: templateId != null,
	});
	const effectiveTemplateId = editorState.templateId ?? templateId ?? null;
	const historyQuery = useQuery({
		queryKey: ["export-template-history", effectiveTemplateId],
		queryFn: () => listReportTemplateHistory(effectiveTemplateId ?? 0),
		enabled: activeTab === "history" && effectiveTemplateId != null,
	});
	const testTaskQuery = useQuery({
		queryKey: ["export-template-test-task", testTaskId],
		queryFn: () => fetchReportTask(testTaskId ?? 0),
		enabled: testTaskId != null,
		refetchInterval: (query) =>
			isTerminalTaskStatus(query.state.data?.status) ? false : 1500,
	});
	const testTask = testTaskQuery.data ?? null;
	const testDetails = testTask?.details?.export ?? null;
	const testOutputQuery = useQuery({
		queryKey: ["export-template-test-output", testTaskId],
		queryFn: () =>
			fetchReportOutput(testTaskId ?? 0, testDetails?.output_content_type),
		enabled:
			testTask != null &&
			isTerminalTaskStatus(testTask.status) &&
			testDetails?.output_available === true,
	});

	useEffect(() => {
		if (
			templateId == null ||
			!templateQuery.data ||
			loadedTemplateIdRef.current === templateId
		) {
			return;
		}
		const nextState = buildTemplateEditorState(templateQuery.data);
		loadedTemplateIdRef.current = templateId;
		initialSnapshotRef.current = JSON.stringify(nextState);
		setEditorState(nextState);
	}, [templateId, templateQuery.data]);

	useEffect(() => {
		if (
			templateId != null ||
			editorState.collectionId ||
			!collectionsQuery.data?.length
		) {
			return;
		}
		const nextState = {
			...editorState,
			collectionId: String(collectionsQuery.data[0].id),
		};
		if (JSON.stringify(editorState) === initialSnapshotRef.current) {
			initialSnapshotRef.current = JSON.stringify(nextState);
		}
		setEditorState(nextState);
	}, [collectionsQuery.data, editorState, templateId]);

	useEffect(() => {
		if (initialTestTaskId != null) setTestTaskId(initialTestTaskId);
	}, [initialTestTaskId]);

	const isDirty = JSON.stringify(editorState) !== initialSnapshotRef.current;
	useEffect(() => {
		if (!isDirty) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [isDirty]);

	const collectionOptions = collectionsQuery.data ?? [];
	const collectionHierarchy = useMemo(
		() => buildCollectionHierarchy(collectionOptions),
		[collectionOptions],
	);
	const classOptions = classesQuery.data ?? [];
	const targetClassOptions = useMemo(
		() => filterClassesForCollection(classOptions, editorState.collectionId),
		[classOptions, editorState.collectionId],
	);
	const classCollectionById = useMemo(
		() =>
			new Map(
				classOptions.map((classItem) => [
					classItem.id,
					classItem.collection.id,
				]),
			),
		[classOptions],
	);
	const validationContext = useMemo(
		() => ({ classCollectionById }),
		[classCollectionById],
	);
	const targetErrors = validateExportTemplateTarget(
		editorState,
		validationContext,
	);
	const targetReady = Object.keys(targetErrors).length === 0;
	const selectedCollection = collectionOptions.find(
		(collection) => String(collection.id) === editorState.collectionId,
	);
	const selectedClass = targetClassOptions.find(
		(classItem) => String(classItem.id) === editorState.classId,
	);
	const schemaDataFields = useMemo(
		() => discoverJsonFields(selectedClass?.json_schema, []),
		[selectedClass?.json_schema],
	);
	const usesSchemaFields = schemaDataFields.length > 0;
	const classObjectSamplesQuery = useQuery({
		queryKey: ["export-template-data-fields", "v3", selectedClass?.id ?? null],
		queryFn: () => fetchClassObjectSamples(selectedClass?.id ?? 0),
		enabled:
			editorState.kind === "export" &&
			scopeNeedsClass &&
			selectedClass != null &&
			!usesSchemaFields,
		staleTime: 60_000,
	});
	const sampledObjects = Array.isArray(classObjectSamplesQuery.data)
		? classObjectSamplesQuery.data
		: [];
	const discoveredDataFields = useMemo(
		() =>
			usesSchemaFields
				? schemaDataFields
				: discoverJsonFields(
						undefined,
						sampledObjects.map((objectItem) => objectItem.data),
					),
		[sampledObjects, schemaDataFields, usesSchemaFields],
	);
	const dataFieldCompletions = useMemo(
		() =>
			discoveredDataFields.map((field) => ({
				path: field.path,
				detail: dataFieldDetail(field, sampledObjects.length),
			})),
		[discoveredDataFields, sampledObjects.length],
	);
	const dataFieldError = classObjectSamplesQuery.isError
		? classObjectSamplesQuery.error instanceof Error
			? classObjectSamplesQuery.error.message
			: "The sample could not be loaded."
		: null;
	const editorTemplateNames = useMemo(() => {
		const collectionId = parsePositiveInteger(editorState.collectionId);
		return (templatesQuery.data?.items ?? [])
			.filter(
				(template) =>
					template.collection_id === collectionId &&
					template.id !== editorState.templateId,
			)
			.map((template) => template.name);
	}, [editorState.collectionId, editorState.templateId, templatesQuery.data]);
	const relationAliases = includeAliasesOf(editorState.includeRows);
	const snippets = useMemo(() => {
		const items = [
			{ label: "Item name", text: "{{ item.name }}" },
			{ label: "Description", text: "{{ item.description }}" },
			{ label: "JSON data", text: "{{ item.data | tojson }}" },
			{
				label: "Item loop",
				text: "{% for item in items %}\n{{ item.name }}\n{% endfor %}",
			},
		];
		for (const alias of relationAliases) {
			items.push({
				label: `Related: ${alias}`,
				text: `{{ item.related.${alias} | tojson }}`,
			});
		}
		for (const name of editorTemplateNames.slice(0, 4)) {
			items.push({
				label: `Include: ${name}`,
				text: `{% include "${name}" %}`,
			});
		}
		return items;
	}, [editorTemplateNames, relationAliases]);

	const saveTemplateMutation = useMutation({
		mutationFn: async ({
			draft,
			intent,
			testObjectId,
			skipSave,
		}: SaveRequest) => {
			const { base, reportFields } = buildTemplatePayload(draft);
			let template: ReportTemplate;
			if (skipSave && draft.templateId) {
				template = await getReportTemplate(draft.templateId);
			} else if (draft.mode === "create") {
				template = await createReportTemplate({
					...base,
					...reportFields,
				} as NewReportTemplate);
			} else {
				if (!draft.templateId) throw new Error("Template id is missing.");
				template = await updateReportTemplate(draft.templateId, {
					...base,
					...reportFields,
				} as UpdateReportTemplate);
			}

			let testTask: TaskResponse | null = null;
			let testError: string | null = null;
			if (intent === "test") {
				try {
					testTask = await runTemplateReport(template.id, {
						object_id:
							draft.scopeKind === "related_objects"
								? parsePositiveInteger(testObjectId)
								: null,
					});
				} catch (error) {
					testError =
						error instanceof Error
							? error.message
							: "Failed to start test run.";
				}
			}

			return { template, intent, testTask, testError } satisfies SaveResult;
		},
		onSuccess: async ({ template, intent, testTask, testError }) => {
			const nextState = buildTemplateEditorState(template);
			initialSnapshotRef.current = JSON.stringify(nextState);
			setEditorState(nextState);
			setFieldErrors({});
			setSaveFeedback(`Saved ${formatTimestamp(template.updated_at)}`);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["export-templates"] }),
				queryClient.invalidateQueries({
					queryKey: ["export-template-history", template.id],
				}),
			]);

			if (testTask) {
				setTestTaskId(testTask.id);
				setActiveTab("appearance");
				setEditorError(null);
				router.replace(`/exports/templates/${template.id}?test=${testTask.id}`);
				return;
			}

			if (intent === "test" && testError) {
				setEditorError(
					`Template saved, but the test could not start. ${testError}`,
				);
			}
			if (templateId == null) {
				router.replace(`/exports/templates/${template.id}`);
			}
		},
		onError: (error) => {
			setEditorError(
				error instanceof Error
					? error.message
					: "Failed to save export template.",
			);
		},
	});

	function updateDraft(
		patch: Partial<ExportTemplateDraft>,
		clearFields: ExportTemplateDraftField[] = [],
	) {
		setEditorState((current) => ({ ...current, ...patch }));
		setSaveFeedback(null);
		setEditorError(null);
		if (clearFields.length) {
			setFieldErrors((current) => {
				const next = { ...current };
				for (const field of clearFields) delete next[field];
				return next;
			});
		}
	}

	function addIncludeRow() {
		updateDraft(
			{
				includeRows: [
					...editorState.includeRows,
					newIncludeRow(createBuilderId()),
				],
			},
			["includeRows"],
		);
	}

	function updateIncludeRow(id: string, patch: Partial<IncludeBuilderRow>) {
		updateDraft(
			{
				includeRows: editorState.includeRows.map((row) =>
					row.id === id ? { ...row, ...patch } : row,
				),
			},
			["includeRows"],
		);
	}

	function removeIncludeRow(id: string) {
		updateDraft(
			{
				includeRows: editorState.includeRows.filter((row) => row.id !== id),
			},
			["includeRows"],
		);
	}

	function isEditorTabDisabled(tab: TemplateEditorTab): boolean {
		if (tab === "history") return effectiveTemplateId == null;
		if (tab === "target") return false;
		if (tab === "appearance") return !targetReady;
		return editorState.kind !== "export" || !targetReady;
	}

	function getNextWorkflowTab(
		tab: TemplateEditorTab,
	): TemplateEditorTab | null {
		const workflow: TemplateEditorTab[] =
			editorState.kind === "export"
				? ["target", "filters", "related", "rules", "appearance"]
				: ["target", "appearance"];
		const index = workflow.indexOf(tab);
		return index >= 0 ? (workflow[index + 1] ?? null) : null;
	}

	function handleBack() {
		if (
			isDirty &&
			!window.confirm("Discard the changes to this export template?")
		) {
			return;
		}
		router.replace("/exports?view=templates");
	}

	function focusField(field: ExportTemplateDraftField) {
		setActiveTab(getEditorTabForErrors({ [field]: "Invalid" }));
		window.setTimeout(
			() => document.getElementById(FIELD_IDS[field])?.focus(),
			0,
		);
	}

	function handleSave(intent: SaveIntent) {
		const errors = validateExportTemplateDraft(editorState, validationContext);
		setFieldErrors(errors);
		setEditorError(null);
		setTestObjectError(null);
		const errorFields = Object.keys(errors) as ExportTemplateDraftField[];
		if (errorFields.length) {
			const firstField = errorFields[0];
			setActiveTab(getEditorTabForErrors({ [firstField]: errors[firstField] }));
			window.setTimeout(
				() => document.getElementById(FIELD_IDS[firstField])?.focus(),
				0,
			);
			return;
		}
		if (
			intent === "test" &&
			editorState.scopeKind === "related_objects" &&
			!parsePositiveInteger(testObjectId)
		) {
			setActiveTab("appearance");
			setTestObjectError(
				"Enter an object ID to test this related-object template.",
			);
			window.setTimeout(
				() => document.getElementById("export-template-test-object")?.focus(),
				0,
			);
			return;
		}
		saveTemplateMutation.mutate({
			draft: editorState,
			intent,
			testObjectId,
			skipSave: intent === "test" && editorState.mode === "edit" && !isDirty,
		});
	}

	function handleContinue() {
		const errors =
			activeTab === "target"
				? validateExportTemplateTarget(editorState, validationContext)
				: activeTab === "related"
					? validateExportTemplateRelated(editorState)
					: activeTab === "rules"
						? validateExportTemplateRules(editorState)
						: {};
		if (
			activeTab === "target" ||
			activeTab === "related" ||
			activeTab === "rules"
		) {
			setFieldErrors(errors);
			setEditorError(null);
			const errorFields = Object.keys(errors) as ExportTemplateDraftField[];
			if (errorFields.length) {
				const firstField = errorFields[0];
				window.setTimeout(
					() => document.getElementById(FIELD_IDS[firstField])?.focus(),
					0,
				);
				return;
			}
		}
		const nextTab = getNextWorkflowTab(activeTab);
		if (!nextTab) return;
		setActiveTab(nextTab);
		window.setTimeout(
			() =>
				document
					.getElementById(
						nextTab === "appearance"
							? "export-template-name"
							: `template-editor-panel-${nextTab}`,
					)
					?.focus(),
			0,
		);
	}

	function handleTabKeyDown(
		event: React.KeyboardEvent<HTMLButtonElement>,
		tab: TemplateEditorTab,
	) {
		const availableTabs = EDITOR_TABS.filter(
			(item) => !isEditorTabDisabled(item.id),
		);
		const index = availableTabs.findIndex((item) => item.id === tab);
		let nextIndex: number | null = null;
		if (event.key === "ArrowRight")
			nextIndex = (index + 1) % availableTabs.length;
		if (event.key === "ArrowLeft")
			nextIndex = (index - 1 + availableTabs.length) % availableTabs.length;
		if (event.key === "Home") nextIndex = 0;
		if (event.key === "End") nextIndex = availableTabs.length - 1;
		if (nextIndex == null) return;
		event.preventDefault();
		const nextTab = availableTabs[nextIndex].id;
		setActiveTab(nextTab);
		window.setTimeout(
			() => document.getElementById(`template-editor-tab-${nextTab}`)?.focus(),
			0,
		);
	}

	if (templateId != null && templateQuery.isLoading) {
		return <div className="card muted">Loading export template…</div>;
	}

	if (templateId != null && templateQuery.isError) {
		return (
			<div className="card stack panel-card">
				<div className="error-banner">
					{templateQuery.error instanceof Error
						? templateQuery.error.message
						: "Failed to load export template."}
				</div>
				<button type="button" className="ghost" onClick={handleBack}>
					Back to templates
				</button>
			</div>
		);
	}

	const isSaving = saveTemplateMutation.isPending;
	const fieldErrorEntries = Object.entries(fieldErrors) as Array<
		[ExportTemplateDraftField, string]
	>;
	const testResult = testOutputQuery.data ?? null;
	const testText = testResult ? getResultText(testResult) : "";
	const testProgress = getTaskProgress(testTask);
	const testActionLabel =
		editorState.mode === "edit" && !isDirty ? "Test" : "Save & test";
	const pendingActionLabel =
		saveTemplateMutation.variables?.intent === "test" ? "Testing…" : "Saving…";
	const nextWorkflowTab = getNextWorkflowTab(activeTab);
	const nextWorkflowLabel = nextWorkflowTab
		? EDITOR_TABS.find((tab) => tab.id === nextWorkflowTab)?.label.replace(
				/^\d+\.\s*/,
				"",
			)
		: null;

	return (
		<section className="stack export-template-page">
			<header className="card export-template-command-bar">
				<div className="stack action-card-header">
					<p className="eyebrow">Exports · Templates</p>
					<h2>
						{editorState.mode === "edit"
							? editorState.name || "Edit template"
							: "Create export template"}
					</h2>
					<span
						className={isDirty ? "save-state save-state--dirty" : "save-state"}
					>
						{editorState.mode === "create"
							? "Not yet saved"
							: isDirty
								? "Unsaved changes"
								: (saveFeedback ?? "All changes saved")}
					</span>
				</div>
				<div className="action-row export-template-page-actions">
					<button
						type="button"
						className="ghost"
						onClick={handleBack}
						disabled={isSaving}
					>
						Back to templates
					</button>
					{nextWorkflowTab ? (
						<button type="button" onClick={handleContinue} disabled={isSaving}>
							Continue to {nextWorkflowLabel?.toLocaleLowerCase()}
						</button>
					) : (
						<>
							<button
								type="button"
								className="ghost"
								onClick={() => handleSave("save")}
								disabled={isSaving || (editorState.mode === "edit" && !isDirty)}
							>
								{isSaving ? pendingActionLabel : "Save"}
							</button>
							{editorState.kind === "export" ? (
								<button
									type="button"
									onClick={() => handleSave("test")}
									disabled={isSaving}
								>
									{isSaving ? pendingActionLabel : testActionLabel}
								</button>
							) : null}
						</>
					)}
				</div>
			</header>

			{editorError ? (
				<div className="error-banner" role="alert">
					{editorError}
				</div>
			) : null}
			{fieldErrorEntries.length ? (
				<div className="validation-summary" role="alert">
					<strong>
						Review {fieldErrorEntries.length} field
						{fieldErrorEntries.length === 1 ? "" : "s"}
					</strong>
					<div className="action-row">
						{fieldErrorEntries.map(([field, message]) => (
							<button
								key={field}
								type="button"
								className="ghost compact-button"
								onClick={() => focusField(field)}
							>
								{FIELD_LABELS[field]}: {message}
							</button>
						))}
					</div>
				</div>
			) : null}

			<div
				className="export-template-editor-tabs"
				role="tablist"
				aria-label="Template editor sections"
			>
				{EDITOR_TABS.map((tab) => {
					const disabled = isEditorTabDisabled(tab.id);
					const disabledHint =
						tab.id === "history"
							? "Available after saving"
							: editorState.kind === "fragment" && tab.id !== "appearance"
								? "Executable exports only"
								: "Complete the target first";
					return (
						<button
							key={tab.id}
							type="button"
							id={`template-editor-tab-${tab.id}`}
							role="tab"
							aria-selected={activeTab === tab.id}
							aria-controls={`template-editor-panel-${tab.id}`}
							tabIndex={activeTab === tab.id ? 0 : -1}
							className={activeTab === tab.id ? "is-active" : ""}
							disabled={disabled}
							onClick={() => setActiveTab(tab.id)}
							onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
						>
							<span>{tab.label}</span>
							<small>{disabled ? disabledHint : tab.hint}</small>
						</button>
					);
				})}
			</div>

			{activeTab === "appearance" ? (
				<div
					id="template-editor-panel-appearance"
					className="export-template-authoring-layout"
					role="tabpanel"
					aria-labelledby="template-editor-tab-appearance"
				>
					<article className="card stack panel-card export-template-content-card">
						<div className="target-context-summary">
							<div className="preview-meta">
								<span>
									{selectedCollection?.name ??
										`Collection #${editorState.collectionId}`}
								</span>
								<span>
									{editorState.kind === "fragment"
										? "Reusable fragment"
										: formatExportScope(editorState.scopeKind)}
								</span>
								{selectedClass ? <span>{selectedClass.name}</span> : null}
							</div>
							<button
								type="button"
								className="ghost compact-button"
								onClick={() => setActiveTab("target")}
							>
								Change target
							</button>
						</div>
						<div className="stack action-card-header">
							<h3>Output appearance</h3>
							<p className="muted">
								Design how the selected target should render and insert
								context-aware snippets at the cursor.
							</p>
						</div>
						<div className="form-grid">
							<label className="control-field" htmlFor="export-template-name">
								<span>Name</span>
								<input
									id="export-template-name"
									value={editorState.name}
									onChange={(event) =>
										updateDraft({ name: event.target.value }, ["name"])
									}
									aria-invalid={Boolean(fieldErrors.name)}
								/>
								{fieldErrors.name ? (
									<small className="field-error">{fieldErrors.name}</small>
								) : null}
							</label>
							<label
								className="control-field"
								htmlFor="export-template-description"
							>
								<span>Description</span>
								<input
									id="export-template-description"
									value={editorState.description}
									onChange={(event) =>
										updateDraft({ description: event.target.value }, [
											"description",
										])
									}
									aria-invalid={Boolean(fieldErrors.description)}
								/>
								{fieldErrors.description ? (
									<small className="field-error">
										{fieldErrors.description}
									</small>
								) : null}
							</label>
							<div className="control-field">
								<label htmlFor="export-template-content-type">
									Content type
								</label>
								{editorState.mode === "create" ? (
									<select
										id="export-template-content-type"
										value={editorState.contentType}
										onChange={(event) =>
											updateDraft({
												contentType: event.target
													.value as StoredReportContentType,
											})
										}
									>
										<option value="text/plain">Plain text</option>
										<option value="text/html">HTML</option>
										<option value="text/csv">CSV</option>
									</select>
								) : (
									<>
										<input
											id="export-template-content-type"
											value={formatExportContentType(editorState.contentType)}
											readOnly
										/>
										<small className="field-note">
											Duplicate the template to use another format.
										</small>
									</>
								)}
							</div>
						</div>

						<div
							className="template-insert-toolbar"
							role="toolbar"
							aria-label="Insert template value"
						>
							<span className="muted">Insert at cursor</span>
							<div className="action-row">
								{snippets.map((snippet) => (
									<button
										key={`${snippet.label}-${snippet.text}`}
										type="button"
										className="ghost compact-button"
										onClick={() =>
											setInsertRequest({
												id: insertRequestIdRef.current++,
												text: snippet.text,
											})
										}
									>
										{snippet.label}
									</button>
								))}
							</div>
						</div>

						{editorState.kind === "export" && scopeNeedsClass ? (
							<details className="export-disclosure template-data-field-disclosure">
								<summary>
									<span>Insert a data field</span>
									<small>
										{discoveredDataFields.length
											? `${discoveredDataFields.length} fields available`
											: usesSchemaFields
												? "From class schema"
												: classObjectSamplesQuery.isFetching
													? "Inspecting objects…"
													: "No fields found"}
									</small>
								</summary>
								<div className="export-disclosure-body">
									<p className="muted">
										Choose a field to insert it at the cursor. You can also type{" "}
										<code>item.data.</code> for autocomplete.
									</p>
									<DataFieldPalette
										fields={discoveredDataFields}
										sampleCount={sampledObjects.length}
										isLoading={classObjectSamplesQuery.isFetching}
										error={dataFieldError}
										sourceMode={usesSchemaFields ? "schema" : "sample"}
										onRefresh={
											usesSchemaFields
												? undefined
												: () => void classObjectSamplesQuery.refetch()
										}
										onInsert={(field) =>
											setInsertRequest({
												id: insertRequestIdRef.current++,
												text: `{{ ${field.templateExpression} }}`,
											})
										}
									/>
								</div>
							</details>
						) : null}

						<TemplateCodeEditor
							label="Template body"
							inputId="export-template-body"
							value={editorState.templateBody}
							rows={22}
							onChange={(templateBody) =>
								updateDraft({ templateBody }, ["templateBody"])
							}
							placeholder={`{% for item in items %}{{ item.name }}\n{% endfor %}`}
							disabled={isSaving}
							error={fieldErrors.templateBody}
							insertRequest={insertRequest}
							scopeKind={
								editorState.kind === "export"
									? editorState.scopeKind
									: undefined
							}
							relationHydrated={
								editorState.kind === "export" &&
								(editorState.scopeKind === "related_objects" ||
									(editorState.scopeKind === "objects_in_class" &&
										editorState.depth.trim() !== ""))
							}
							relationAliases={relationAliases}
							templateNames={editorTemplateNames}
							dataFields={dataFieldCompletions}
						/>

						<details className="export-disclosure">
							<summary>
								<span>Template language reference</span>
								<small>Variables, relations, and helpers</small>
							</summary>
							<div className="template-help export-disclosure-body">
								{TEMPLATE_HELP.map((item) => (
									<p key={item} className="muted">
										{item}
									</p>
								))}
							</div>
						</details>
					</article>

					<aside className="card stack panel-card export-template-preview-card">
						<div className="panel-header">
							<div className="stack action-card-header">
								<h3>Test output</h3>
								<p className="muted">
									Runs the saved template against live data.
								</p>
							</div>
							{testTask ? (
								<span
									className={`status-pill status-pill--${getTaskStatusTone(testTask.status)}`}
								>
									{testTask.status.replaceAll("_", " ")}
								</span>
							) : null}
						</div>

						{editorState.scopeKind === "related_objects" &&
						editorState.kind === "export" ? (
							<label
								className="control-field"
								htmlFor="export-template-test-object"
							>
								<span>Test object ID</span>
								<input
									id="export-template-test-object"
									type="number"
									min={1}
									value={testObjectId}
									onChange={(event) => {
										setTestObjectId(event.target.value);
										setTestObjectError(null);
									}}
									aria-invalid={Boolean(testObjectError)}
									placeholder="Required for this scope"
								/>
								{testObjectError ? (
									<small className="field-error">{testObjectError}</small>
								) : null}
							</label>
						) : null}

						{!testTaskId ? (
							<div className="empty-state empty-state--actionable">
								<div className="stack empty-state-copy">
									<strong>No test run yet</strong>
									<span>
										Save & test validates the template and renders a real
										result.
									</span>
								</div>
								{editorState.kind === "export" ? (
									<button
										type="button"
										onClick={() => handleSave("test")}
										disabled={isSaving}
									>
										{testActionLabel}
									</button>
								) : null}
							</div>
						) : null}

						{testTaskQuery.isLoading ? (
							<div className="muted">Starting test run…</div>
						) : null}
						{testTaskQuery.isError ? (
							<div className="error-banner">
								{testTaskQuery.error instanceof Error
									? testTaskQuery.error.message
									: "Failed to load the test run."}
							</div>
						) : null}
						{testTask && !isTerminalTaskStatus(testTask.status) ? (
							<>
								<div
									className="export-progress"
									role="progressbar"
									aria-label="Template test progress"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={testProgress}
								>
									<span style={{ width: `${testProgress}%` }} />
								</div>
								<div className="muted">
									{testTask.progress.processed_items} of{" "}
									{testTask.progress.total_items} items processed
								</div>
							</>
						) : null}
						{testTask &&
						(testTask.status === "failed" ||
							testTask.status === "cancelled") ? (
							<div className="error-banner">
								{testTask.summary || "The test run did not produce output."}
							</div>
						) : null}
						{testOutputQuery.isLoading ? (
							<div className="muted">Loading rendered output…</div>
						) : null}
						{testOutputQuery.isError ? (
							<div className="error-banner">
								{testOutputQuery.error instanceof Error
									? testOutputQuery.error.message
									: "Failed to load test output."}
							</div>
						) : null}
						{testTask &&
						isTerminalTaskStatus(testTask.status) &&
						testTask.status !== "failed" &&
						testTask.status !== "cancelled" &&
						testDetails?.output_available !== true &&
						!testOutputQuery.isLoading ? (
							<div className="empty-state">
								The test completed without stored output.
							</div>
						) : null}
						{testResult ? (
							<div className="stack template-test-result">
								<div className="preview-meta">
									<span>{formatExportContentType(testResult.contentType)}</span>
									<span>
										{formatBytes(new TextEncoder().encode(testText).byteLength)}
									</span>
									<span>{testResult.warningCount} warning(s)</span>
									{testResult.truncated ? <span>Truncated</span> : null}
								</div>
								{testResult.contentType === "text/html" ? (
									<iframe
										className="html-preview"
										title="Rendered template test"
										sandbox=""
										srcDoc={testText}
									/>
								) : (
									<pre className="response-preview template-test-output">
										{testText || "The test produced an empty result."}
									</pre>
								)}
							</div>
						) : null}
					</aside>
				</div>
			) : null}

			{activeTab === "target" ? (
				<div
					id="template-editor-panel-target"
					className="stack export-template-data-panel"
					role="tabpanel"
					aria-labelledby="template-editor-tab-target"
				>
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Export target</h3>
							<p className="muted">
								First choose what this template targets. Filters, related data,
								and export rules follow before appearance.
							</p>
						</div>
						<div className="form-grid">
							<label className="control-field" htmlFor="export-template-kind">
								<span>Template type</span>
								<select
									id="export-template-kind"
									value={editorState.kind}
									onChange={(event) =>
										updateDraft(
											{
												kind: event.target.value as ExportTemplateDraft["kind"],
											},
											["classId", "includeRows"],
										)
									}
								>
									<option value="export">Executable export</option>
									<option value="fragment">Reusable fragment</option>
								</select>
							</label>
							<div className="control-field">
								<label htmlFor="export-template-collection">Collection</label>
								{collectionOptions.length ? (
									<select
										id="export-template-collection"
										value={editorState.collectionId}
										onChange={(event) =>
											updateDraft(
												{
													collectionId: event.target.value,
													classId: "",
													includeRows: [],
												},
												["collectionId", "classId", "includeRows"],
											)
										}
										aria-invalid={Boolean(fieldErrors.collectionId)}
									>
										{collectionOptions.map((collection) => (
											<option key={collection.id} value={collection.id}>
												{formatCollectionOption(
													collection,
													collectionHierarchy.byId,
												)}
											</option>
										))}
									</select>
								) : (
									<input
										id="export-template-collection"
										type="number"
										min={1}
										value={editorState.collectionId}
										onChange={(event) =>
											updateDraft(
												{
													collectionId: event.target.value,
													classId: "",
													includeRows: [],
												},
												["collectionId", "classId", "includeRows"],
											)
										}
										placeholder="Collection ID"
										aria-invalid={Boolean(fieldErrors.collectionId)}
									/>
								)}
								{fieldErrors.collectionId ? (
									<small className="field-error">
										{fieldErrors.collectionId}
									</small>
								) : null}
							</div>

							{editorState.kind === "export" ? (
								<label
									className="control-field"
									htmlFor="export-template-scope"
								>
									<span>Scope</span>
									<select
										id="export-template-scope"
										value={editorState.scopeKind}
										onChange={(event) => {
											const scopeKind = event.target
												.value as ExportTemplateDraft["scopeKind"];
											const nextScopeNeedsClass =
												scopeKind === "objects_in_class" ||
												scopeKind === "related_objects";
											updateDraft(
												{
													scopeKind,
													...(nextScopeNeedsClass
														? {}
														: {
																classId: "",
																includeRows: [],
																depth: "",
															}),
												},
												["classId", "includeRows", "depth"],
											);
										}}
									>
										{[
											"collections",
											"classes",
											"objects_in_class",
											"class_relations",
											"object_relations",
											"related_objects",
										].map((scope) => (
											<option key={scope} value={scope}>
												{formatExportScope(scope)}
											</option>
										))}
									</select>
								</label>
							) : null}

							{editorState.kind === "export" && scopeNeedsClass ? (
								<div className="control-field">
									<label htmlFor="export-template-class">Class</label>
									<select
										id="export-template-class"
										value={editorState.classId}
										onChange={(event) =>
											updateDraft({ classId: event.target.value }, ["classId"])
										}
										aria-invalid={Boolean(fieldErrors.classId)}
										disabled={
											classesQuery.isLoading || !targetClassOptions.length
										}
									>
										<option value="">
											{classesQuery.isLoading
												? "Loading classes…"
												: targetClassOptions.length
													? "Select class"
													: "No classes in this collection"}
										</option>
										{targetClassOptions.map((classItem) => (
											<option key={classItem.id} value={classItem.id}>
												{classItem.name} (#{classItem.id})
											</option>
										))}
									</select>
									{classesQuery.isError ? (
										<small className="field-error">
											Classes could not be loaded for this collection.
										</small>
									) : null}
									{fieldErrors.classId ? (
										<small className="field-error">{fieldErrors.classId}</small>
									) : null}
								</div>
							) : null}
						</div>
					</article>

					{editorState.kind === "export" && scopeNeedsClass && selectedClass ? (
						<article className="card stack panel-card">
							<div className="stack action-card-header">
								<h3>Available data fields</h3>
								<p className="muted">
									{usesSchemaFields
										? "These fields come from the class schema and will be available in Appearance and editor autocomplete."
										: "This class has no discoverable schema fields, so the editor inspects its first 100 objects. Sampled fields may not represent every object and will be carried into Appearance and editor autocomplete."}
								</p>
							</div>
							<DataFieldPalette
								fields={discoveredDataFields}
								sampleCount={sampledObjects.length}
								isLoading={classObjectSamplesQuery.isFetching}
								error={dataFieldError}
								sourceMode={usesSchemaFields ? "schema" : "sample"}
								onRefresh={
									usesSchemaFields
										? undefined
										: () => void classObjectSamplesQuery.refetch()
								}
							/>
						</article>
					) : null}

					<WorkflowContinueBar
						title={
							targetReady
								? "Target ready"
								: "Complete the target selection to continue"
						}
						summary={`${selectedCollection?.name ?? "Choose a collection"} · ${
							editorState.kind === "export"
								? formatExportScope(editorState.scopeKind)
								: "Reusable fragment"
						}${selectedClass ? ` · ${selectedClass.name}` : ""}`}
						nextLabel={editorState.kind === "export" ? "Filters" : "Appearance"}
						onContinue={handleContinue}
					/>
				</div>
			) : null}

			{activeTab === "filters" ? (
				<div
					id="template-editor-panel-filters"
					className="stack export-template-data-panel"
					role="tabpanel"
					aria-labelledby="template-editor-tab-filters"
					tabIndex={-1}
				>
					<ReportQueryBuilder
						idPrefix="export-template-query"
						scopeKind={editorState.scopeKind}
						value={editorState.defaultQuery}
						onChange={(defaultQuery) => updateDraft({ defaultQuery })}
						disabled={isSaving}
					/>
					<WorkflowContinueBar
						title="Filters ready"
						summary={
							editorState.defaultQuery
								? "Default filters and sorting are configured."
								: "No defaults—every matching target row will be included."
						}
						nextLabel="Related"
						onContinue={handleContinue}
					/>
				</div>
			) : null}

			{activeTab === "related" ? (
				<div
					id="template-editor-panel-related"
					className="stack export-template-data-panel"
					role="tabpanel"
					aria-labelledby="template-editor-tab-related"
					tabIndex={-1}
				>
					{scopeNeedsClass ? (
						<>
							<section id="export-template-includes" tabIndex={-1}>
								<IncludeRows
									rows={editorState.includeRows}
									classOptions={classOptions}
									onAdd={addIncludeRow}
									onUpdate={updateIncludeRow}
									onRemove={removeIncludeRow}
									error={fieldErrors.includeRows}
									disabled={isSaving}
								/>
							</section>
							<article className="card stack panel-card">
								<div className="stack action-card-header">
									<h3>Relation hydration</h3>
									<p className="muted">
										Make reachable objects and traversal paths available to the
										template.
									</p>
								</div>
								<label
									className="control-field"
									htmlFor="export-template-depth"
								>
									<span>Hydration depth</span>
									<input
										id="export-template-depth"
										type="number"
										min={1}
										max={2}
										value={editorState.depth}
										onChange={(event) =>
											updateDraft({ depth: event.target.value }, ["depth"])
										}
										placeholder="Off"
										aria-invalid={Boolean(fieldErrors.depth)}
									/>
									<small className="field-note">
										Leave empty to hydrate only explicitly included relations.
									</small>
									{fieldErrors.depth ? (
										<small className="field-error">{fieldErrors.depth}</small>
									) : null}
								</label>
							</article>
						</>
					) : (
						<article className="card stack panel-card">
							<div className="stack action-card-header">
								<h3>No related settings for this scope</h3>
								<p className="muted">
									Related-object includes require an object class target. You
									can continue without configuring this stage.
								</p>
							</div>
						</article>
					)}
					<WorkflowContinueBar
						title="Related data ready"
						summary={
							scopeNeedsClass
								? `${editorState.includeRows.length} include${editorState.includeRows.length === 1 ? "" : "s"} · ${
										editorState.depth
											? `hydration depth ${editorState.depth}`
											: "explicit includes only"
									}`
								: "This scope has no related-object configuration."
						}
						nextLabel="Rules"
						onContinue={handleContinue}
					/>
				</div>
			) : null}

			{activeTab === "rules" ? (
				<div
					id="template-editor-panel-rules"
					className="stack export-template-data-panel"
					role="tabpanel"
					aria-labelledby="template-editor-tab-rules"
					tabIndex={-1}
				>
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Export rules</h3>
							<p className="muted">
								Decide how missing values render and put safety limits on each
								export.
							</p>
						</div>
						<div className="form-grid">
							<label
								className="control-field"
								htmlFor="export-template-missing-policy"
							>
								<span>Missing data policy</span>
								<select
									id="export-template-missing-policy"
									value={editorState.missingDataPolicy}
									onChange={(event) =>
										updateDraft({
											missingDataPolicy: event.target
												.value as ExportTemplateDraft["missingDataPolicy"],
										})
									}
								>
									<option value="strict">Fail export</option>
									<option value="null">Render null</option>
									<option value="omit">Render an empty value</option>
								</select>
							</label>
							<label
								className="control-field"
								htmlFor="export-template-max-items"
							>
								<span>Maximum items</span>
								<input
									id="export-template-max-items"
									type="number"
									min={1}
									value={editorState.maxItems}
									onChange={(event) =>
										updateDraft({ maxItems: event.target.value }, ["maxItems"])
									}
									placeholder="Server default"
									aria-invalid={Boolean(fieldErrors.maxItems)}
								/>
								{fieldErrors.maxItems ? (
									<small className="field-error">{fieldErrors.maxItems}</small>
								) : null}
							</label>
							<label
								className="control-field"
								htmlFor="export-template-max-output"
							>
								<span>Maximum output size (bytes)</span>
								<input
									id="export-template-max-output"
									type="number"
									min={1}
									value={editorState.maxOutputBytes}
									onChange={(event) =>
										updateDraft({ maxOutputBytes: event.target.value }, [
											"maxOutputBytes",
										])
									}
									placeholder="Server default"
									aria-invalid={Boolean(fieldErrors.maxOutputBytes)}
								/>
								{parsePositiveInteger(editorState.maxOutputBytes) ? (
									<small className="field-note">
										{formatBytes(
											parsePositiveInteger(editorState.maxOutputBytes) ?? 0,
										)}
									</small>
								) : null}
								{fieldErrors.maxOutputBytes ? (
									<small className="field-error">
										{fieldErrors.maxOutputBytes}
									</small>
								) : null}
							</label>
						</div>
					</article>
					<WorkflowContinueBar
						title="Rules ready"
						summary={`Missing values: ${editorState.missingDataPolicy} · ${
							editorState.maxItems
								? `up to ${editorState.maxItems} items`
								: "server item limit"
						}`}
						nextLabel="Appearance"
						onContinue={handleContinue}
					/>
				</div>
			) : null}

			{activeTab === "history" ? (
				<div
					id="template-editor-panel-history"
					className="stack"
					role="tabpanel"
					aria-labelledby="template-editor-tab-history"
				>
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Saved history</h3>
							<p className="muted">
								Inspect previous versions and who changed them.
							</p>
						</div>
						{historyQuery.isLoading ? (
							<div className="muted">Loading saved versions…</div>
						) : null}
						{historyQuery.isError ? (
							<div className="error-banner">
								{historyQuery.error instanceof Error
									? historyQuery.error.message
									: "Failed to load template history."}
							</div>
						) : null}
						{historyQuery.data?.length ? (
							<div className="history-entry-list">
								{historyQuery.data.map((entry) => (
									<HistoryEntry key={entry.history_id} entry={entry} />
								))}
							</div>
						) : null}
						{!historyQuery.isLoading &&
						!historyQuery.isError &&
						historyQuery.data?.length === 0 ? (
							<div className="empty-state">
								No saved history is available yet.
							</div>
						) : null}
					</article>
				</div>
			) : null}
		</section>
	);
}
