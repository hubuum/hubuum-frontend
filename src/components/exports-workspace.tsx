"use client";

import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { CreateModal } from "@/components/create-modal";
import { EmptyState } from "@/components/empty-state";
import { IncludeRows } from "@/components/include-rows";
import { TableExportMenu } from "@/components/table-export-menu";
import { TemplateCodeEditor } from "@/components/template-code-editor";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1Classes,
	getApiV1ClassesByClassIdTrailing,
	getApiV1Collections,
} from "@/lib/api/generated/client";
import type {
	HubuumClassExpanded,
	HubuumObject,
	Collection,
} from "@/lib/api/generated/models";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
} from "@/lib/collection-hierarchy";
import {
	createReportTemplate,
	deleteReportTemplate,
	fetchReportOutput,
	fetchReportTask,
	listReportTemplates,
	type NewReportTemplate,
	type ReportContentType,
	type ReportExecutionResult,
	type ReportInclude,
	type ReportMissingDataPolicy,
	type ReportRequest,
	type ReportScopeKind,
	type ReportTemplate,
	type ReportTemplateKind,
	type ReportTemplateRunRequest,
	runTemplateReport,
	submitJsonReportTask,
	type StoredReportContentType,
	type TaskResponse,
	type UpdateReportTemplate,
	updateReportTemplate,
} from "@/lib/api/reporting";
import { fetchTasks, isTerminalTaskStatus } from "@/lib/api/tasking";
import {
	buildIncludeFromRows,
	includeAliasesOf,
	includeRowsFromTemplate,
	type IncludeBuilderRow,
	newIncludeRow,
} from "@/lib/report-include";
import {
	type QueryFieldKind,
	SCOPE_QUERY_FIELDS,
} from "@/lib/report-scope-fields";

type TemplateEditorState = {
	mode: "create" | "edit";
	templateId: number | null;
	collectionId: string;
	name: string;
	description: string;
	contentType: StoredReportContentType;
	templateBody: string;
	kind: ReportTemplateKind;
	scopeKind: ReportScopeKind;
	classId: string;
	defaultQuery: string;
	includeRows: IncludeBuilderRow[];
	depth: string;
	missingDataPolicy: ReportMissingDataPolicy;
	maxItems: string;
	maxOutputBytes: string;
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

type ResultActionFeedback = {
	tone: "success" | "danger";
	message: string;
} | null;

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
	"{{ item.name }} interpolates a value; {% for item in items %} ... {% endfor %} loops arrays.",
	"Root context: items, meta.*, warnings, request.*, and source (related_objects).",
	"Relations: item.related.<alias> (includes), item.reachable.*/paths.* (when hydrated) — each is a list, e.g. item.related.room[0].name.",
	"Helpers: coalesce(...), | tojson, | csv_cell, | default(...), | default_if_empty(...), | format_datetime(...), | join_nonempty(...).",
	"HTML templates are autoescaped; use | tojson or | csv_cell for sensitive values in text/CSV.",
	"include/import/extends resolve within the same collection (e.g. layout.*, macros.*, partial.*, export.*).",
	"Stored templates support text/plain, text/html, and text/csv.",
] as const;

const DEFAULT_TEMPLATE_EDITOR: TemplateEditorState = {
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
	"regex",
] as const;
const NUMBER_OPERATORS = [
	"equals",
	"gt",
	"gte",
	"lt",
	"lte",
	"between",
] as const;
const ARRAY_OPERATORS = ["equals", "contains"] as const;
const BOOLEAN_OPERATORS = ["equals"] as const;
const JSON_OPERATORS = [
	"equals",
	"contains",
	"gt",
	"gte",
	"lt",
	"lte",
	"between",
] as const;
const PREVIEW_BYTE_LIMIT = 64 * 1024;
const FULL_COPY_BYTE_LIMIT = 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function formatTimestamp(value: string | null): string {
	if (!value) {
		return "n/a";
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

function buildTemplateEditorState(
	template?: ReportTemplate | null,
): TemplateEditorState {
	if (!template) {
		return DEFAULT_TEMPLATE_EDITOR;
	}

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

function buildQueryString(
	filters: QueryBuilderFilter[],
	sorts: QueryBuilderSort[],
	advancedQueryText: string,
): string {
	const params = new URLSearchParams();

	filters.forEach((filter) => {
		if (!filter.field || !filter.value.trim()) {
			return;
		}

		const key =
			filter.operator === "equals"
				? filter.field
				: `${filter.field}__${filter.operator}`;
		params.append(key, filter.value.trim());
	});

	const sortValue = sorts
		.filter((sort) => sort.field)
		.map((sort) => `${sort.field}.${sort.direction}`)
		.join(",");
	if (sortValue) {
		params.set("sort", sortValue);
	}

	const advancedQuery = new URLSearchParams(
		advancedQueryText.startsWith("?")
			? advancedQueryText.slice(1)
			: advancedQueryText,
	);
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

function clampTextByBytes(
	text: string,
	byteLimit: number,
): { text: string; byteCount: number; capped: boolean } {
	const bytes = textEncoder.encode(text);
	if (bytes.byteLength <= byteLimit) {
		return {
			text,
			byteCount: bytes.byteLength,
			capped: false,
		};
	}

	let end = byteLimit;
	while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
		end -= 1;
	}

	return {
		text: textDecoder.decode(bytes.slice(0, end)).trimEnd(),
		byteCount: end,
		capped: true,
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
		result.contentType === "text/html" &&
		!result.truncated &&
		!preview.capped &&
		Boolean(fullText.trim());

	return {
		fullText,
		previewText: preview.text,
		totalBytes,
		previewBytes: preview.byteCount,
		previewCapped: preview.capped,
		canCopyFull: totalBytes <= FULL_COPY_BYTE_LIMIT,
		showInlineHtmlPreview,
	};
}

function downloadReportResult(
	result: ReportExecutionResult,
	filenameStem: string,
	body: string,
) {
	const extensionByType: Record<ReportContentType, string> = {
		"application/json": "json",
		"text/plain": "txt",
		"text/html": "html",
		"text/csv": "csv",
	};
	const mimeType =
		result.contentType === "application/json"
			? "application/json;charset=utf-8"
			: `${result.contentType};charset=utf-8`;
	const blob = new Blob([body], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	const timestamp = new Date().toISOString().replaceAll(":", "-");
	anchor.href = url;
	anchor.download = `${filenameStem}-${timestamp}.${extensionByType[result.contentType]}`;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections({ include_total: false }, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}

	return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes({ include_total: false }, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	return response.data;
}

async function fetchObjectsByClass(classId: number): Promise<HubuumObject[]> {
	const response = await getApiV1ClassesByClassIdTrailing(classId, undefined, {
		credentials: "include",
	});

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load objects."),
		);
	}

	return Array.isArray(response.data) ? (response.data as HubuumObject[]) : [];
}

export function ExportsWorkspace() {
	const queryClient = useQueryClient();
	const [editorState, setEditorState] = useState<TemplateEditorState | null>(
		null,
	);
	const [editorError, setEditorError] = useState<string | null>(null);
	const [selectedTemplateId, setSelectedTemplateId] = useState("");
	const [runMode, setRunMode] = useState<"json" | "template">("json");
	const [scopeKind, setScopeKind] = useState<ReportScopeKind>("collections");
	const [classId, setClassId] = useState("");
	const [objectId, setObjectId] = useState("");
	const [advancedQueryText, setAdvancedQueryText] = useState("");
	const [missingDataPolicy, setMissingDataPolicy] =
		useState<ReportMissingDataPolicy>("strict");
	const [relationDepth, setRelationDepth] = useState("");
	const [maxItems, setMaxItems] = useState("100");
	const [maxOutputBytes, setMaxOutputBytes] = useState("262144");
	// run-template overrides
	const [overrideQuery, setOverrideQuery] = useState("");
	const [overrideObjectId, setOverrideObjectId] = useState("");
	const [overridePolicy, setOverridePolicy] = useState<ReportMissingDataPolicy | "">("");
	const [overrideMaxItems, setOverrideMaxItems] = useState("");
	const [overrideMaxOutputBytes, setOverrideMaxOutputBytes] = useState("");
	const [runnerError, setRunnerError] = useState<string | null>(null);
	const [lastReportTask, setLastReportTask] = useState<TaskResponse | null>(null);
	const [lastResult, setLastResult] = useState<ReportExecutionResult | null>(null);
	const [resultActionFeedback, setResultActionFeedback] =
		useState<ResultActionFeedback>(null);
	const [reportRunFeedback, setReportRunFeedback] =
		useState<ResultActionFeedback>(null);
	const [reportRunActionId, setReportRunActionId] = useState<number | null>(null);
	const [builderFilters, setBuilderFilters] = useState<QueryBuilderFilter[]>([]);
	const [builderSorts, setBuilderSorts] = useState<QueryBuilderSort[]>([]);
	const [includeRows, setIncludeRows] = useState<IncludeBuilderRow[]>([]);

	const templatesQuery = useInfiniteQuery({
		queryKey: ["export-templates"],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam }) => listReportTemplates(pageParam),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
	const collectionsQuery = useQuery({
		queryKey: ["collections", "exports"],
		queryFn: fetchCollections,
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "exports"],
		queryFn: fetchClasses,
	});
	const parsedClassId = useMemo(() => parsePositiveInteger(classId), [classId]);
	const objectsQuery = useQuery({
		queryKey: ["export-objects", parsedClassId],
		queryFn: () => fetchObjectsByClass(parsedClassId ?? 0),
		enabled: parsedClassId !== null,
	});
	const reportRunsQuery = useQuery({
		queryKey: ["export-runs", "recent"],
		queryFn: () =>
			fetchTasks({
				kind: "export",
				status: "succeeded",
				limit: 10,
				sort: "created_at.desc,id.desc",
			}),
	});
	const reportTaskQuery = useQuery({
		queryKey: ["export-task", lastReportTask?.id ?? null],
		queryFn: () => fetchReportTask(lastReportTask?.id ?? 0),
		enabled: lastReportTask !== null,
		refetchInterval: (query) =>
			isTerminalTaskStatus(query.state.data?.status ?? lastReportTask?.status)
				? false
				: 2000,
	});

	const templates = useMemo(
		() => templatesQuery.data?.pages.flatMap((page) => page.items) ?? [],
		[templatesQuery.data?.pages],
	);
	const runnableTemplates = useMemo(
		() => templates.filter((template) => template.kind === "export"),
		[templates],
	);
	const editorTemplateNames = useMemo(() => {
		if (!editorState) return [];
		const ns = parsePositiveInteger(editorState.collectionId);
		return templates
			.filter((t) => t.collection_id === ns && t.id !== editorState.templateId)
			.map((t) => t.name);
	}, [editorState, templates]);
	const selectedTemplate = useMemo(
		() =>
			runnableTemplates.find(
				(template) => String(template.id) === selectedTemplateId,
			) ?? null,
		[selectedTemplateId, runnableTemplates],
	);
	const scopeFields = useMemo(() => SCOPE_QUERY_FIELDS[scopeKind], [scopeKind]);
	const sortFields = useMemo(
		() => scopeFields.filter((field) => field.sortable),
		[scopeFields],
	);
	const builtQuery = useMemo(
		() => buildQueryString(builderFilters, builderSorts, advancedQueryText),
		[advancedQueryText, builderFilters, builderSorts],
	);
	const lastResultView = useMemo(
		() => (lastResult ? getReportResultView(lastResult) : null),
		[lastResult],
	);
	const successfulReportRuns = useMemo(
		() =>
			(reportRunsQuery.data?.tasks ?? []).filter(
				(task) => task.details?.export?.output_available === true,
			),
		[reportRunsQuery.data?.tasks],
	);
	const reportRunsExportView = {
		id: "recent-export-runs",
		fileName: "recent-export-runs",
		sheetName: "Export runs",
		columns: [
			{
				key: "run",
				label: "Run",
				getValue: (task: (typeof successfulReportRuns)[number]) => {
					const details = task.details?.export ?? null;
					return `Export #${task.id}\n${details?.template_name ?? task.summary ?? "Ad-hoc export"}`;
				},
			},
			{
				key: "created",
				label: "Created",
				getValue: (task: (typeof successfulReportRuns)[number]) =>
					formatTimestamp(task.created_at),
			},
			{
				key: "type",
				label: "Type",
				getValue: (task: (typeof successfulReportRuns)[number]) =>
					task.details?.export?.output_content_type ?? "available",
			},
		],
		rows: successfulReportRuns,
	};
	const activeReportTask = reportTaskQuery.data ?? lastReportTask;
	const reportDetails = activeReportTask?.details?.export ?? null;
	const reportTerminal =
		activeReportTask != null && isTerminalTaskStatus(activeReportTask.status);
	const reportFailed =
		activeReportTask != null &&
		(activeReportTask.status === "failed" ||
			activeReportTask.status === "cancelled");
	const reportPartial = activeReportTask?.status === "partially_succeeded";
	const reportOutputQuery = useQuery({
		queryKey: ["export-output", activeReportTask?.id ?? null],
		queryFn: () =>
			fetchReportOutput(
				activeReportTask?.id ?? 0,
				reportDetails?.output_content_type,
			),
		enabled:
			activeReportTask != null &&
			isTerminalTaskStatus(activeReportTask.status) &&
			reportDetails?.output_available === true,
	});

	useEffect(() => {
		if (!selectedTemplateId) return;
		if (!runnableTemplates.some((t) => String(t.id) === selectedTemplateId)) {
			setSelectedTemplateId("");
		}
	}, [selectedTemplateId, runnableTemplates]);

	useEffect(() => {
		if (reportTaskQuery.data) {
			setLastReportTask(reportTaskQuery.data);
		}
	}, [reportTaskQuery.data]);

	useEffect(() => {
		if (reportOutputQuery.data) {
			setLastResult(reportOutputQuery.data);
			setRunnerError(null);
		}
	}, [reportOutputQuery.data]);

	useEffect(() => {
		if (reportOutputQuery.isError) {
			setLastResult(null);
			setRunnerError(
				reportOutputQuery.error instanceof Error
					? reportOutputQuery.error.message
					: "Failed to fetch export output.",
			);
		}
	}, [reportOutputQuery.error, reportOutputQuery.isError]);

	useEffect(() => {
		const allowedFields = new Set(scopeFields.map((field) => field.key));
		const allowedSortFields = new Set(sortFields.map((field) => field.key));

		setBuilderFilters((current) =>
			current.filter((filter) => allowedFields.has(filter.field)),
		);
		setBuilderSorts((current) =>
			current.filter((sort) => allowedSortFields.has(sort.field)),
		);
	}, [scopeFields, sortFields]);

	useEffect(() => {
		if (scopeKind !== "objects_in_class" && scopeKind !== "related_objects") {
			setIncludeRows([]);
		}
	}, [scopeKind]);

	const saveTemplateMutation = useMutation({
		mutationFn: async (draft: TemplateEditorState) => {
			const collectionId = parsePositiveInteger(draft.collectionId);
			if (!collectionId) throw new Error("Collection is required.");
			if (!draft.name.trim()) throw new Error("Name is required.");
			if (!draft.description.trim()) throw new Error("Description is required.");
			if (!draft.templateBody.trim()) throw new Error("Template body is required.");

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
				if (scopeNeedsClass && !classId) {
					throw new Error("Class is required for the selected scope.");
				}
				let include = null;
				if (scopeNeedsClass) {
					const built = buildIncludeFromRows(draft.includeRows);
					if ("error" in built) throw new Error(built.error);
					include = built.include;
				}
				let relationContext = null;
				if (draft.depth.trim()) {
					const depth = parsePositiveInteger(draft.depth);
					if (!depth || depth < 1 || depth > 2) {
						throw new Error("Relation depth must be 1 or 2.");
					}
					relationContext = { depth };
				}
				const maxItems = draft.maxItems.trim()
					? parsePositiveInteger(draft.maxItems)
					: null;
				const maxOutputBytes = draft.maxOutputBytes.trim()
					? parsePositiveInteger(draft.maxOutputBytes)
					: null;
				const defaultLimits =
					maxItems != null || maxOutputBytes != null
						? { max_items: maxItems, max_output_bytes: maxOutputBytes }
						: null;
				reportFields = {
					scope_kind: draft.scopeKind,
					class_id: scopeNeedsClass ? classId : null,
					default_query: draft.defaultQuery.trim() || null,
					include,
					relation_context: relationContext,
					default_missing_data_policy: draft.missingDataPolicy,
					default_limits: defaultLimits,
				};
			} else if (draft.mode === "edit") {
				// Switching an existing template to a fragment: clear the export-only
				// fields on the record (PATCH null) so it satisfies backend scoping
				// constraints. On create, these are simply omitted.
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

			if (draft.mode === "create") {
				return createReportTemplate({ ...base, ...reportFields } as NewReportTemplate);
			}
			if (!draft.templateId) throw new Error("Template id is missing.");
			return updateReportTemplate(
				draft.templateId,
				{ ...base, ...reportFields } as UpdateReportTemplate,
			);
		},
		onSuccess: async (template) => {
			await queryClient.invalidateQueries({ queryKey: ["export-templates"] });
			setSelectedTemplateId(String(template.id));
			setEditorState(null);
			setEditorError(null);
		},
		onError: (error) => {
			setEditorError(
				error instanceof Error
					? error.message
					: "Failed to save export template.",
			);
		},
	});

	const deleteTemplateMutation = useMutation({
		mutationFn: deleteReportTemplate,
		onSuccess: async (_, templateId) => {
			await queryClient.invalidateQueries({ queryKey: ["export-templates"] });
			if (selectedTemplateId === String(templateId)) {
				setSelectedTemplateId("");
			}
		},
	});

	const runReportMutation = useMutation({
		mutationFn: async (request: ReportRequest) => submitJsonReportTask(request),
		onSuccess: (task) => {
			setRunnerError(null);
			setLastReportTask(task);
			setLastResult(null);
			setResultActionFeedback(null);
			void queryClient.invalidateQueries({ queryKey: ["export-runs"] });
		},
		onError: (error) => {
			setLastResult(null);
			setLastReportTask(null);
			setResultActionFeedback(null);
			setRunnerError(error instanceof Error ? error.message : "Failed to submit export.");
		},
	});

	const runTemplateMutation = useMutation({
		mutationFn: async (vars: { templateId: number; overrides: ReportTemplateRunRequest }) =>
			runTemplateReport(vars.templateId, vars.overrides),
		onSuccess: (task) => {
			setRunnerError(null);
			setLastReportTask(task);
			setLastResult(null);
			setResultActionFeedback(null);
			void queryClient.invalidateQueries({ queryKey: ["export-runs"] });
		},
		onError: (error) => {
			setLastResult(null);
			setLastReportTask(null);
			setResultActionFeedback(null);
			setRunnerError(error instanceof Error ? error.message : "Failed to run template export.");
		},
	});

	function openCreateModal() {
		setEditorState({
			...DEFAULT_TEMPLATE_EDITOR,
			collectionId: collectionsQuery.data?.length
				? String(collectionsQuery.data[0].id)
				: "",
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

	function loadReportRun(task: TaskResponse) {
		setRunnerError(null);
		setResultActionFeedback(null);
		setLastResult(null);
		setLastReportTask(task);
	}

	async function viewReportRunInBrowser(task: TaskResponse) {
		const tab = window.open("", "_blank");
		if (!tab) {
			setReportRunFeedback({
				tone: "danger",
				message: "Could not open a new browser tab for the export output.",
			});
			return;
		}

		tab.document.title = `Export ${task.id}`;
		tab.document.body.textContent = "Loading export output...";

		setReportRunActionId(task.id);
		setReportRunFeedback(null);
		try {
			const result = await fetchReportOutput(
				task.id,
				task.details?.export?.output_content_type,
			);
			const text = getResultText(result);
			const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			tab.location.href = url;
			window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch (error) {
			tab.close();
			setReportRunFeedback({
				tone: "danger",
				message:
					error instanceof Error
						? error.message
						: "Failed to open export output.",
			});
		} finally {
			setReportRunActionId(null);
		}
	}

	async function downloadReportRun(task: TaskResponse) {
		const contentType = task.details?.export?.output_content_type;
		setReportRunActionId(task.id);
		setReportRunFeedback(null);
		try {
			const result = await fetchReportOutput(task.id, contentType);
			downloadReportResult(result, `export-${task.id}`, getResultText(result));
			setReportRunFeedback({
				tone: "success",
				message: `Export #${task.id} downloaded.`,
			});
		} catch (error) {
			setReportRunFeedback({
				tone: "danger",
				message:
					error instanceof Error
						? error.message
						: "Failed to download export output.",
			});
		} finally {
			setReportRunActionId(null);
		}
	}

	function addEditorIncludeRow() {
		setEditorState((current) =>
			current
				? { ...current, includeRows: [...current.includeRows, newIncludeRow(createBuilderId())] }
				: current,
		);
	}
	function updateEditorIncludeRow(id: string, patch: Partial<IncludeBuilderRow>) {
		setEditorState((current) =>
			current
				? {
						...current,
						includeRows: current.includeRows.map((row) =>
							row.id === id ? { ...row, ...patch } : row,
						),
					}
				: current,
		);
	}
	function removeEditorIncludeRow(id: string) {
		setEditorState((current) =>
			current
				? { ...current, includeRows: current.includeRows.filter((row) => row.id !== id) }
				: current,
		);
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
				value: "",
			},
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
				direction: "asc",
			},
		]);
	}

	function addIncludeRow() {
		setIncludeRows((current) => [...current, newIncludeRow(createBuilderId())]);
	}

	function updateIncludeRow(id: string, patch: Partial<IncludeBuilderRow>) {
		setIncludeRows((current) =>
			current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
		);
	}

	function removeIncludeRow(id: string) {
		setIncludeRows((current) => current.filter((row) => row.id !== id));
	}

	function handleRunReport(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const scope: ReportRequest["scope"] = { kind: scopeKind };
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

		const depthApplies =
			scopeKind === "objects_in_class" || scopeKind === "related_objects";
		let relationContext: ReportRequest["relation_context"] = null;
		if (depthApplies && relationDepth.trim()) {
			const parsedDepth = parsePositiveInteger(relationDepth);
			if (!parsedDepth || parsedDepth < 1 || parsedDepth > 2) {
				setRunnerError("Relation hydration depth must be 1 or 2.");
				return;
			}
			relationContext = { depth: parsedDepth };
		}

		let include: ReportInclude | null = null;
		if (scopeKind === "objects_in_class" || scopeKind === "related_objects") {
			const built = buildIncludeFromRows(includeRows);
			if ("error" in built) {
				setRunnerError(built.error);
				return;
			}
			include = built.include;
		}

		setRunnerError(null);
		setResultActionFeedback(null);
		setLastResult(null);
		setLastReportTask(null);
		runReportMutation.mutate({
			scope,
			include,
			query: builtQuery || null,
			relation_context: relationContext,
			missing_data_policy: missingDataPolicy,
			limits: {
				max_items: parsePositiveInteger(maxItems),
				max_output_bytes: parsePositiveInteger(maxOutputBytes),
			},
		});
	}

	function handleRunTemplate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedTemplate) {
			setRunnerError("Select a template to run.");
			return;
		}
		const overrides: ReportTemplateRunRequest = {};
		if (overrideQuery.trim()) overrides.query = overrideQuery.trim();
		if (selectedTemplate.scope_kind === "related_objects") {
			const parsed = parsePositiveInteger(overrideObjectId);
			if (!parsed) {
				setRunnerError("This template is related_objects-scoped; an object id is required.");
				return;
			}
			overrides.object_id = parsed;
		}
		if (overridePolicy) overrides.missing_data_policy = overridePolicy;
		const oMaxItems = overrideMaxItems.trim() ? parsePositiveInteger(overrideMaxItems) : null;
		const oMaxBytes = overrideMaxOutputBytes.trim()
			? parsePositiveInteger(overrideMaxOutputBytes)
			: null;
		if (oMaxItems != null || oMaxBytes != null) {
			overrides.limits = { max_items: oMaxItems, max_output_bytes: oMaxBytes };
		}

		setRunnerError(null);
		setResultActionFeedback(null);
		setLastResult(null);
		setLastReportTask(null);
		runTemplateMutation.mutate({ templateId: selectedTemplate.id, overrides });
	}

	async function copyReportText(text: string, label: string) {
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error("Clipboard access is unavailable in this browser.");
			}

			await navigator.clipboard.writeText(text);
			setResultActionFeedback({
				tone: "success",
				message: `${label} copied to the clipboard.`,
			});
		} catch (error) {
			setResultActionFeedback({
				tone: "danger",
				message:
					error instanceof Error
						? error.message
						: `Failed to copy ${label.toLowerCase()}.`,
			});
		}
	}

	const collectionOptions = collectionsQuery.data ?? [];
	const collectionHierarchy = useMemo(
		() => buildCollectionHierarchy(collectionOptions),
		[collectionOptions],
	);
	const classOptions = classesQuery.data ?? [];
	const objectOptions = objectsQuery.data ?? [];

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Exports</p>
					<h2>Templates and export runner</h2>
				</div>
				<p className="muted">
					Manage stored templates, then run server-side export as JSON, plain
					text, HTML, or CSV.
				</p>
			</header>

			<div className="export-layout">
				<section className="stack">
					<article className="card stack panel-card">
						<div className="panel-header">
							<div className="stack action-card-header">
								<h3>Template library</h3>
								<p className="muted">
									Stored templates are collection-scoped and control text output
									format.
								</p>
							</div>
							<button type="button" onClick={openCreateModal}>
								Create template
							</button>
						</div>

						{templatesQuery.isLoading ? (
							<div className="muted">Loading templates...</div>
						) : null}
						{templatesQuery.isError ? (
							<div className="error-banner">
								Failed to load templates.{" "}
								{templatesQuery.error instanceof Error
									? templatesQuery.error.message
									: "Unknown error"}
							</div>
						) : null}
						{!templatesQuery.isLoading && !templates.length ? (
							<EmptyState
								title="No export templates available yet."
								description="Create a template to save reusable export logic for a collection or class."
								action={
									<button type="button" onClick={openCreateModal}>
										New template
									</button>
								}
							/>
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
												Collection #{template.collection_id} ·{" "}
												{template.content_type}
											</p>
										</div>
										<span className="template-stamp">
											Updated {formatTimestamp(template.updated_at)}
										</span>
									</div>
									<p className="template-description">{template.description}</p>
									<pre className="template-snippet template-snippet--compact">
										{template.template}
									</pre>
									<div className="action-row">
										<button
											type="button"
											className="ghost"
											onClick={() => {
												setSelectedTemplateId(String(template.id));
												setRunMode("template");
												setRunnerError(null);
											}}
										>
											Use in runner
										</button>
										<button
											type="button"
											className="ghost"
											onClick={() => openEditModal(template)}
										>
											Edit
										</button>
										<button
											type="button"
											className="danger"
											onClick={() => {
												if (
													!window.confirm(`Delete template "${template.name}"?`)
												) {
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
								{templatesQuery.isFetchingNextPage
									? "Loading more..."
									: "Load more templates"}
							</button>
						) : null}
					</article>
				</section>

				<section className="stack">
					<article className="card stack panel-card">
						<div className="stack action-card-header">
							<h3>Export runner</h3>
							<p className="muted">
								Build a scope-aware query, then return JSON or render a stored
								template.
							</p>
						</div>

						<div className="action-row">
							<button
								type="button"
								className={runMode === "json" ? "" : "ghost"}
								onClick={() => { setRunMode("json"); setRunnerError(null); }}
							>
								JSON export
							</button>
							<button
								type="button"
								className={runMode === "template" ? "" : "ghost"}
								onClick={() => { setRunMode("template"); setRunnerError(null); }}
							>
								Run template
							</button>
						</div>

						{runMode === "json" ? (
							<form className="stack" onSubmit={handleRunReport}>
								<div className="form-grid">
								<label className="control-field">
									<span>Scope</span>
									<select
										value={scopeKind}
										onChange={(event) =>
											setScopeKind(event.target.value as ReportScopeKind)
										}
									>
										<option value="collections">Collections</option>
										<option value="classes">Classes</option>
										<option value="objects_in_class">Objects in class</option>
										<option value="class_relations">Class relations</option>
										<option value="object_relations">Object relations</option>
										<option value="related_objects">Related objects</option>
									</select>
								</label>

								{scopeKind === "objects_in_class" ||
								scopeKind === "related_objects" ? (
									<div className="control-field">
										<label htmlFor="export-class">Class</label>
										{classOptions.length > 0 ? (
											<select
												id="export-class"
												value={classId}
												onChange={(event) => setClassId(event.target.value)}
											>
												<option value="">Select class</option>
												{classOptions.map((classItem) => (
													<option key={classItem.id} value={classItem.id}>
														{classItem.name} (#{classItem.id})
													</option>
												))}
											</select>
										) : (
											<input
												id="export-class"
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
										<label htmlFor="export-object">Object</label>
										{objectOptions.length > 0 ? (
											<select
												id="export-object"
												value={objectId}
												onChange={(event) => setObjectId(event.target.value)}
											>
												<option value="">Select object</option>
												{objectOptions.map((objectItem) => (
													<option key={objectItem.id} value={objectItem.id}>
														{objectItem.name} (#{objectItem.id})
													</option>
												))}
											</select>
										) : (
											<input
												id="export-object"
												type="number"
												min={1}
												value={objectId}
												onChange={(event) => setObjectId(event.target.value)}
												placeholder="Enter object ID"
											/>
										)}
									</div>
								) : null}

								<div className="query-builder-card control-field--wide">
									<div className="panel-header">
										<div className="stack action-card-header">
											<h4>Query builder</h4>
											<p className="muted">
												Available fields in the selectors below are limited to
												the current scope.
											</p>
										</div>
										<div className="action-row">
											<button
												type="button"
												className="ghost"
												onClick={addFilter}
											>
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
												const fieldDefinition =
													scopeFields.find(
														(field) => field.key === filter.field,
													) ?? scopeFields[0];
												const operatorOptions = getOperatorsForField(
													fieldDefinition.kind,
												);

												return (
													<div key={filter.id} className="query-row">
														<select
															value={filter.field}
															onChange={(event) => {
																const nextField =
																	scopeFields.find(
																		(field) => field.key === event.target.value,
																	) ?? scopeFields[0];
																setBuilderFilters((current) =>
																	current.map((currentFilter) =>
																		currentFilter.id === filter.id
																			? {
																					...currentFilter,
																					field: nextField.key,
																					operator: getOperatorsForField(
																						nextField.kind,
																					)[0],
																				}
																			: currentFilter,
																	),
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
																			? {
																					...currentFilter,
																					operator: event.target.value,
																				}
																			: currentFilter,
																	),
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
																			? {
																					...currentFilter,
																					value: event.target.value,
																				}
																			: currentFilter,
																	),
																)
															}
															placeholder={
																filter.operator === "between"
																	? "min,max"
																	: "value"
															}
														/>
														<button
															type="button"
															className="ghost"
															onClick={() =>
																setBuilderFilters((current) =>
																	current.filter(
																		(currentFilter) =>
																			currentFilter.id !== filter.id,
																	),
																)
															}
														>
															Remove
														</button>
													</div>
												);
											})}
										</div>
									) : (
										<div className="empty-state">
											No filters yet. Add a filter or use the advanced query
											input.
										</div>
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
																	currentSort.id === sort.id
																		? {
																				...currentSort,
																				field: event.target.value,
																			}
																		: currentSort,
																),
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
																		? {
																				...currentSort,
																				direction: event.target.value as
																					| "asc"
																					| "desc",
																			}
																		: currentSort,
																),
															)
														}
													>
														<option value="asc">asc</option>
														<option value="desc">desc</option>
													</select>
													<button
														type="button"
														className="ghost"
														onClick={() =>
															setBuilderSorts((current) =>
																current.filter(
																	(currentSort) => currentSort.id !== sort.id,
																),
															)
														}
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
											onChange={(event) =>
												setAdvancedQueryText(event.target.value)
											}
											placeholder="permissions__contains=ReadClass&created_at__gte=2026-03-01T00:00:00Z"
										/>
									</label>

									<label className="control-field control-field--wide">
										<span>Generated query string</span>
										<textarea
											value={builtQuery}
											readOnly
											placeholder="Query string will appear here."
										/>
									</label>
								</div>

								{scopeKind === "objects_in_class" ||
								scopeKind === "related_objects" ? (
									<IncludeRows
										rows={includeRows}
										classOptions={classOptions}
										onAdd={addIncludeRow}
										onUpdate={updateIncludeRow}
										onRemove={removeIncludeRow}
									/>
								) : null}

								<label className="control-field">
									<span>Missing data policy</span>
									<select
										value={missingDataPolicy}
										onChange={(event) =>
											setMissingDataPolicy(
												event.target.value as ReportMissingDataPolicy,
											)
										}
									>
										<option value="strict">Strict</option>
										<option value="null">Null</option>
										<option value="omit">Omit</option>
									</select>
								</label>

								{scopeKind === "objects_in_class" ||
								scopeKind === "related_objects" ? (
									<label className="control-field">
										<span>Relation hydration depth</span>
										<input
											type="number"
											min={1}
											max={2}
											value={relationDepth}
											onChange={(event) => setRelationDepth(event.target.value)}
											placeholder={
												scopeKind === "related_objects" ? "2 (default)" : "Off"
											}
										/>
									</label>
								) : null}

								<label className="control-field">
									<span>Max items</span>
									<input
										type="number"
										min={1}
										value={maxItems}
										onChange={(event) => setMaxItems(event.target.value)}
									/>
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

							{runnerError ? (
								<div className="error-banner">{runnerError}</div>
							) : null}

							<div className="action-row">
								<button type="submit" disabled={runReportMutation.isPending}>
									{runReportMutation.isPending
										? "Submitting..."
										: "Run export"}
								</button>
							</div>
						</form>
					) : null}

					{runMode === "template" ? (
						<form className="stack" onSubmit={handleRunTemplate}>
							<label className="control-field control-field--wide">
								<span>Template</span>
								<select
									value={selectedTemplateId}
									onChange={(event) => setSelectedTemplateId(event.target.value)}
								>
									<option value="">Select an export template</option>
									{runnableTemplates.map((template) => (
										<option key={template.id} value={template.id}>
											{template.name} ({template.content_type})
										</option>
									))}
								</select>
							</label>

							{selectedTemplate ? (
								<div className="preview-meta">
									<span>scope: {selectedTemplate.scope_kind ?? "n/a"}</span>
									{selectedTemplate.class_id != null ? (
										<span>class #{selectedTemplate.class_id}</span>
									) : null}
									{selectedTemplate.default_query ? (
										<span>default query: {selectedTemplate.default_query}</span>
									) : null}
									{selectedTemplate.relation_context?.depth != null ? (
										<span>depth {selectedTemplate.relation_context.depth}</span>
									) : null}
									<span>{selectedTemplate.content_type}</span>
								</div>
							) : null}

							<div className="form-grid">
								<label className="control-field control-field--wide">
									<span>Override query (optional)</span>
									<input
										value={overrideQuery}
										onChange={(event) => setOverrideQuery(event.target.value)}
										placeholder={selectedTemplate?.default_query ?? "name__contains=srv-"}
									/>
								</label>

								{selectedTemplate?.scope_kind === "related_objects" ? (
									<label className="control-field">
										<span>Object id</span>
										<input
											type="number"
											min={1}
											value={overrideObjectId}
											onChange={(event) => setOverrideObjectId(event.target.value)}
											placeholder="root object id"
										/>
									</label>
								) : null}

								<label className="control-field">
									<span>Override missing data policy</span>
									<select
										value={overridePolicy}
										onChange={(event) =>
											setOverridePolicy(
												event.target.value as ReportMissingDataPolicy | "",
											)
										}
									>
										<option value="">Use template default</option>
										<option value="strict">Strict</option>
										<option value="null">Null</option>
										<option value="omit">Omit</option>
									</select>
								</label>

								<label className="control-field">
									<span>Override max items</span>
									<input
										type="number"
										min={1}
										value={overrideMaxItems}
										onChange={(event) => setOverrideMaxItems(event.target.value)}
										placeholder="template default"
									/>
								</label>

								<label className="control-field">
									<span>Override max output bytes</span>
									<input
										type="number"
										min={1}
										value={overrideMaxOutputBytes}
										onChange={(event) => setOverrideMaxOutputBytes(event.target.value)}
										placeholder="template default"
									/>
								</label>
							</div>

							{runnerError ? <div className="error-banner">{runnerError}</div> : null}

							<div className="action-row">
								<button type="submit" disabled={runTemplateMutation.isPending || !selectedTemplate}>
									{runTemplateMutation.isPending ? "Submitting..." : "Run template"}
								</button>
							</div>
						</form>
					) : null}
					</article>

					<article className="card stack panel-card">
						<div className="panel-header">
							<div className="stack action-card-header">
								<h3>Recent export runs</h3>
								<p className="muted">
									Open completed export output while the backend still has it
									stored.
								</p>
							</div>
							<TableExportMenu
								view={reportRunsExportView}
								disabled={reportRunsQuery.isFetching}
								compact
							/>
						</div>

						{reportRunsQuery.isLoading ? (
							<div className="muted">Loading recent export runs...</div>
						) : null}
						{reportRunsQuery.isError ? (
							<div className="error-banner">
								Failed to load recent export runs.{" "}
								{reportRunsQuery.error instanceof Error
									? reportRunsQuery.error.message
									: "Unknown error"}
							</div>
						) : null}
						{!reportRunsQuery.isLoading &&
						!reportRunsQuery.isError &&
						successfulReportRuns.length === 0 ? (
							<div className="empty-state">
								No successful export runs with stored output found.
							</div>
						) : null}
						{reportRunFeedback ? (
							<div
								className={
									reportRunFeedback.tone === "danger"
										? "error-banner"
										: "info-banner"
								}
							>
								{reportRunFeedback.message}
							</div>
						) : null}
						{successfulReportRuns.length ? (
							<div className="table-wrap">
								<table>
									<thead>
										<tr>
											<th>Run</th>
											<th>Created</th>
											<th>Type</th>
											<th />
										</tr>
									</thead>
									<tbody>
										{successfulReportRuns.map((task) => {
											const taskReportDetails = task.details?.export ?? null;
											const isActionPending = reportRunActionId === task.id;
											return (
												<tr key={task.id}>
													<td>
														<div className="stack table-cell-stack">
															<strong>Export #{task.id}</strong>
															<span className="muted">
																{taskReportDetails?.template_name ??
																	task.summary ??
																	"Ad-hoc export"}
															</span>
														</div>
													</td>
													<td>{formatTimestamp(task.created_at)}</td>
													<td>{taskReportDetails?.output_content_type ?? "available"}</td>
													<td>
														<div className="action-row">
															<button
																type="button"
																className="ghost"
																onClick={() => loadReportRun(task)}
																disabled={isActionPending}
															>
																Preview
															</button>
															<button
																type="button"
																className="ghost"
																onClick={() => viewReportRunInBrowser(task)}
																disabled={isActionPending}
															>
																Open text
															</button>
															<button
																type="button"
																className="ghost"
																onClick={() => downloadReportRun(task)}
																disabled={isActionPending}
															>
																Download
															</button>
														</div>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						) : null}
					</article>

					<article className="card stack panel-card">
						<div className="panel-header">
							<div className="stack action-card-header">
								<h3>Result console</h3>
								<p className="muted">
									Exports run as background tasks. When the task finishes, the
									stored output is fetched here for preview, copy, or download.
								</p>
							</div>
						</div>

						{activeReportTask ? (
							<div className="preview-meta">
								<span>Task #{activeReportTask.id}</span>
								<span>{activeReportTask.status}</span>
								<span>
									{activeReportTask.progress.processed_items} /{" "}
									{activeReportTask.progress.total_items} processed
								</span>
								{reportDetails?.output_content_type ? (
									<span>{reportDetails.output_content_type}</span>
								) : null}
								{reportDetails?.warning_count != null ? (
									<span>{reportDetails.warning_count} warning(s)</span>
								) : null}
								{reportDetails?.truncated != null ? (
									<span>
										{reportDetails.truncated
											? "Truncated by backend"
											: "Backend complete"}
									</span>
								) : null}
								{reportDetails?.output_expires_at ? (
									<span>
										Output expires {formatTimestamp(reportDetails.output_expires_at)}
									</span>
								) : null}
							</div>
						) : null}

						{activeReportTask &&
						!isTerminalTaskStatus(activeReportTask.status) ? (
							<div className="info-banner">
								Export task is {activeReportTask.status}. This page is polling
								for completion.
							</div>
						) : null}

						{reportFailed ? (
							<div className="error-banner">
								Export {activeReportTask?.status}.{" "}
								{activeReportTask?.summary?.trim()
									? activeReportTask.summary
									: "The task did not produce output."}
							</div>
						) : null}

						{reportPartial &&
						reportDetails?.output_available !== true &&
						!lastResult ? (
							<div className="info-banner">
								Export partially succeeded.{" "}
								{activeReportTask?.summary?.trim()
									? activeReportTask.summary
									: "Some items failed and no full output is available."}
							</div>
						) : null}

						{reportTerminal &&
						!reportFailed &&
						!reportPartial &&
						reportDetails?.output_available !== true &&
						!lastResult ? (
							<div className="empty-state">
								No stored export output is available for this task.
							</div>
						) : null}

						{reportOutputQuery.isLoading ? (
							<div className="muted">Loading stored output...</div>
						) : null}

						{!activeReportTask && !lastResult ? (
							<div className="empty-state">
								Run an export to inspect the response.
							</div>
						) : null}
						{lastResult && lastResultView ? (
							<div className="stack">
								<div className="result-toolbar">
									<div className="preview-meta">
										<span>{lastResult.contentType}</span>
										<span>{formatBytes(lastResultView.totalBytes)}</span>
										<span>{lastResult.warningCount} warning(s)</span>
										<span>
											{lastResult.truncated
												? "Truncated by backend"
												: "Backend complete"}
										</span>
										<span>
											{lastResultView.previewCapped
												? `Preview capped at ${formatBytes(PREVIEW_BYTE_LIMIT)}`
												: "Full preview"}
										</span>
									</div>

									<div className="action-row">
										<button
											type="button"
											className="ghost"
											onClick={() =>
												downloadReportResult(
													lastResult,
													`export-${scopeKind}`,
													lastResultView.fullText,
												)
											}
										>
											Download full result
										</button>
										{lastResult.contentType !== "text/html" ||
										lastResultView.showInlineHtmlPreview ? (
											<button
												type="button"
												className="ghost"
												onClick={() =>
													copyReportText(lastResultView.previewText, "Preview")
												}
												disabled={!lastResultView.previewText}
											>
												Copy preview
											</button>
										) : null}
										{lastResult.contentType !== "text/html" ||
										lastResultView.showInlineHtmlPreview ? (
											<button
												type="button"
												className="ghost"
												onClick={() =>
													copyReportText(lastResultView.fullText, "Full result")
												}
												disabled={!lastResultView.canCopyFull}
											>
												Copy full result
											</button>
										) : null}
									</div>
								</div>

								{!lastResultView.canCopyFull ? (
									<div className="muted">
										Full copy is disabled above{" "}
										{formatBytes(FULL_COPY_BYTE_LIMIT)}. Download the full
										result instead.
									</div>
								) : null}

								{resultActionFeedback ? (
									<div
										className={
											resultActionFeedback.tone === "danger"
												? "error-banner"
												: "info-banner"
										}
									>
										{resultActionFeedback.message}
									</div>
								) : null}

								{lastResult.contentType === "text/html" &&
								!lastResultView.showInlineHtmlPreview ? (
									<div className="empty-state">
										HTML preview is hidden for large or incomplete output.
										Download the full result to inspect it safely.
									</div>
								) : null}

								{lastResultView.previewCapped &&
								lastResult.contentType !== "text/html" ? (
									<div className="empty-state">
										This inline preview only shows the first{" "}
										{formatBytes(lastResultView.previewBytes)}. Use download for
										the full payload.
									</div>
								) : null}

								{(lastResult.contentType === "application/json" ||
									lastResult.contentType === "text/plain" ||
									lastResult.contentType === "text/csv") &&
								lastResultView.previewText ? (
									<pre className="response-preview">
										{lastResultView.previewText}
									</pre>
								) : null}

								{lastResult.contentType === "text/html" &&
								lastResultView.showInlineHtmlPreview ? (
									<iframe
										className="html-preview"
										sandbox=""
										srcDoc={lastResultView.fullText}
										title="Export HTML preview"
									/>
								) : null}
							</div>
						) : null}
					</article>
				</section>
			</div>

			<CreateModal
				open={editorState !== null}
				title={
					editorState?.mode === "edit"
						? "Edit export template"
						: "Create export template"
				}
				onClose={closeEditor}
			>
				{editorState ? (
					<form
						className="stack"
						onSubmit={(event) => {
							event.preventDefault();
							setEditorError(null);
							saveTemplateMutation.mutate(editorState);
						}}
					>
						<div className="form-grid">
							<div className="control-field">
								<label htmlFor="export-template-collection">Collection</label>
								{collectionOptions.length > 0 ? (
									<select
										id="export-template-collection"
										value={editorState.collectionId}
										onChange={(event) =>
											setEditorState({
												...editorState,
												collectionId: event.target.value,
											})
										}
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
											setEditorState({
												...editorState,
												collectionId: event.target.value,
											})
										}
										placeholder="Enter collection ID"
									/>
								)}
							</div>

							<label className="control-field">
								<span>Name</span>
								<input
									value={editorState.name}
									onChange={(event) =>
										setEditorState({ ...editorState, name: event.target.value })
									}
									required
								/>
							</label>

							<label className="control-field control-field--wide">
								<span>Description</span>
								<input
									value={editorState.description}
									onChange={(event) =>
										setEditorState({
											...editorState,
											description: event.target.value,
										})
									}
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
												contentType: event.target
													.value as StoredReportContentType,
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

							<label className="control-field">
								<span>Kind</span>
								<select
									value={editorState.kind}
									onChange={(event) =>
										setEditorState({
											...editorState,
											kind: event.target.value as ReportTemplateKind,
										})
									}
								>
									<option value="export">export (executable)</option>
									<option value="fragment">fragment (include/import/extends)</option>
								</select>
							</label>

							{editorState.kind === "export" ? (
								<>
									<label className="control-field">
										<span>Scope</span>
										<select
											value={editorState.scopeKind}
											onChange={(event) =>
												setEditorState({
													...editorState,
													scopeKind: event.target.value as ReportScopeKind,
												})
											}
										>
											<option value="collections">Collections</option>
											<option value="classes">Classes</option>
											<option value="objects_in_class">Objects in class</option>
											<option value="class_relations">Class relations</option>
											<option value="object_relations">Object relations</option>
											<option value="related_objects">Related objects</option>
										</select>
									</label>

									{editorState.scopeKind === "objects_in_class" ||
									editorState.scopeKind === "related_objects" ? (
										<div className="control-field">
											<label htmlFor="template-class">Class</label>
											{classOptions.length > 0 ? (
												<select
													id="template-class"
													value={editorState.classId}
													onChange={(event) =>
														setEditorState({ ...editorState, classId: event.target.value })
													}
												>
													<option value="">Select class</option>
													{classOptions.map((classItem) => (
														<option key={classItem.id} value={classItem.id}>
															{classItem.name} (#{classItem.id})
														</option>
													))}
												</select>
											) : (
												<input
													id="template-class"
													type="number"
													min={1}
													value={editorState.classId}
													onChange={(event) =>
														setEditorState({ ...editorState, classId: event.target.value })
													}
													placeholder="Enter class ID"
												/>
											)}
										</div>
									) : null}

									<label className="control-field control-field--wide">
										<span>Default query</span>
										<input
											value={editorState.defaultQuery}
											onChange={(event) =>
												setEditorState({ ...editorState, defaultQuery: event.target.value })
											}
											placeholder="name__contains=srv-&sort=name"
										/>
									</label>

									{editorState.scopeKind === "objects_in_class" ||
									editorState.scopeKind === "related_objects" ? (
										<IncludeRows
											rows={editorState.includeRows}
											classOptions={classOptions}
											onAdd={addEditorIncludeRow}
											onUpdate={updateEditorIncludeRow}
											onRemove={removeEditorIncludeRow}
										/>
									) : null}

									{editorState.scopeKind === "objects_in_class" ||
									editorState.scopeKind === "related_objects" ? (
										<label className="control-field">
											<span>Relation hydration depth</span>
											<input
												type="number"
												min={1}
												max={2}
												value={editorState.depth}
												onChange={(event) =>
													setEditorState({ ...editorState, depth: event.target.value })
												}
												placeholder={
													editorState.scopeKind === "related_objects" ? "2 (default)" : "Off"
												}
											/>
										</label>
									) : null}

									<label className="control-field">
										<span>Default missing data policy</span>
										<select
											value={editorState.missingDataPolicy}
											onChange={(event) =>
												setEditorState({
													...editorState,
													missingDataPolicy: event.target.value as ReportMissingDataPolicy,
												})
											}
										>
											<option value="strict">Strict</option>
											<option value="null">Null</option>
											<option value="omit">Omit</option>
										</select>
									</label>

									<label className="control-field">
										<span>Default max items</span>
										<input
											type="number"
											min={1}
											value={editorState.maxItems}
											onChange={(event) =>
												setEditorState({ ...editorState, maxItems: event.target.value })
											}
											placeholder="optional"
										/>
									</label>

									<label className="control-field">
										<span>Default max output bytes</span>
										<input
											type="number"
											min={1}
											value={editorState.maxOutputBytes}
											onChange={(event) =>
												setEditorState({ ...editorState, maxOutputBytes: event.target.value })
											}
											placeholder="optional"
										/>
									</label>
								</>
							) : null}
						</div>

						<TemplateCodeEditor
							label="Template body"
							value={editorState.templateBody}
							onChange={(templateBody) =>
								setEditorState({ ...editorState, templateBody })
							}
							placeholder={`{% for item in items %}{{ item.name }}
{% endfor %}`}
							disabled={saveTemplateMutation.isPending}
							scopeKind={editorState.kind === "export" ? editorState.scopeKind : undefined}
							relationHydrated={
								editorState.kind === "export" &&
								(editorState.scopeKind === "related_objects" ||
									(editorState.scopeKind === "objects_in_class" &&
										editorState.depth.trim() !== ""))
							}
							relationAliases={includeAliasesOf(editorState.includeRows)}
							templateNames={editorTemplateNames}
						/>

						<div className="template-help">
							{TEMPLATE_HELP.map((item) => (
								<p key={item} className="muted">
									{item}
								</p>
							))}
						</div>

						{editorError ? (
							<div className="error-banner">{editorError}</div>
						) : null}

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
							<button
								type="button"
								className="ghost"
								onClick={closeEditor}
								disabled={saveTemplateMutation.isPending}
							>
								Cancel
							</button>
						</div>
					</form>
				) : null}
			</CreateModal>
		</section>
	);
}
