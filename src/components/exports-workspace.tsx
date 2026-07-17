"use client";

import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useState,
} from "react";

import { EmptyState } from "@/components/empty-state";
import { IncludeRows } from "@/components/include-rows";
import { TableExportMenu } from "@/components/table-export-menu";
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
	deleteReportTemplate,
	fetchReportOutput,
	fetchReportTask,
	listReportTemplates,
	type ReportContentType,
	type ReportExecutionResult,
	type ReportInclude,
	type ReportMissingDataPolicy,
	type ReportRequest,
	type ReportScopeKind,
	type ReportTemplate,
	type ReportTemplateRunRequest,
	runTemplateReport,
	submitJsonReportTask,
	type TaskResponse,
} from "@/lib/api/reporting";
import { fetchTasks, isTerminalTaskStatus } from "@/lib/api/tasking";
import {
	buildIncludeFromRows,
	type IncludeBuilderRow,
	newIncludeRow,
} from "@/lib/report-include";
import {
	type QueryFieldKind,
	SCOPE_QUERY_FIELDS,
} from "@/lib/report-scope-fields";
import {
	filterReportTemplates,
	formatExportContentType,
	formatExportScope,
	type ExportWorkspaceView,
} from "@/lib/export-workspace";

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
const EXPORT_WORKSPACE_VIEWS = ["run", "templates", "history"] as const;
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

function formatQueryField(value: string): string {
	return value
		.replaceAll("_", " ")
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatQueryOperator(value: string): string {
	const labels: Record<string, string> = {
		equals: "Equals",
		iequals: "Equals, ignoring case",
		contains: "Contains",
		icontains: "Contains, ignoring case",
		startswith: "Starts with",
		istartswith: "Starts with, ignoring case",
		endswith: "Ends with",
		iendswith: "Ends with, ignoring case",
		like: "Matches pattern",
		regex: "Matches regular expression",
		gt: "Greater than",
		gte: "Greater than or equal to",
		lt: "Less than",
		lte: "Less than or equal to",
		between: "Between",
	};

	return labels[value] ?? value;
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

function getTaskStatusTone(
	status: TaskResponse["status"],
): "neutral" | "success" | "danger" | "accent" {
	if (status === "succeeded") return "success";
	if (status === "failed" || status === "cancelled") return "danger";
	if (status === "partially_succeeded") return "accent";
	return "neutral";
}

function getTaskProgressPercent(task: TaskResponse | null): number {
	if (!task) return 0;
	if (isTerminalTaskStatus(task.status)) return 100;
	if (task.progress.total_items <= 0) return 0;

	return Math.min(
		100,
		Math.round(
			(task.progress.processed_items / task.progress.total_items) * 100,
		),
	);
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
	const response = await getApiV1Collections(
		{ include_total: false },
		{
			credentials: "include",
		},
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
		{ include_total: false },
		{
			credentials: "include",
		},
	);

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

type ExportsWorkspaceProps = {
	initialView?: ExportWorkspaceView;
};

export function ExportsWorkspace({
	initialView = "run",
}: ExportsWorkspaceProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [activeView, setActiveView] =
		useState<ExportWorkspaceView>(initialView);
	const [templateSearch, setTemplateSearch] = useState("");
	const [templateCollectionFilter, setTemplateCollectionFilter] = useState("");
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
	const [overridePolicy, setOverridePolicy] = useState<
		ReportMissingDataPolicy | ""
	>("");
	const [overrideMaxItems, setOverrideMaxItems] = useState("");
	const [overrideMaxOutputBytes, setOverrideMaxOutputBytes] = useState("");
	const [runnerError, setRunnerError] = useState<string | null>(null);
	const [lastReportTask, setLastReportTask] = useState<TaskResponse | null>(
		null,
	);
	const [lastResult, setLastResult] = useState<ReportExecutionResult | null>(
		null,
	);
	const [resultActionFeedback, setResultActionFeedback] =
		useState<ResultActionFeedback>(null);
	const [reportRunFeedback, setReportRunFeedback] =
		useState<ResultActionFeedback>(null);
	const [reportRunActionId, setReportRunActionId] = useState<number | null>(
		null,
	);
	const [builderFilters, setBuilderFilters] = useState<QueryBuilderFilter[]>(
		[],
	);
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
				limit: 20,
				sort: "created_at.desc,id.desc",
			}),
		refetchInterval: (query) =>
			query.state.data?.tasks.some((task) => !isTerminalTaskStatus(task.status))
				? 2000
				: false,
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
	const parsedTemplateCollectionFilter = useMemo(
		() => parsePositiveInteger(templateCollectionFilter),
		[templateCollectionFilter],
	);
	const filteredTemplates = useMemo(
		() =>
			filterReportTemplates(templates, {
				collectionId: parsedTemplateCollectionFilter,
				query: templateSearch,
			}),
		[parsedTemplateCollectionFilter, templateSearch, templates],
	);
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
	const reportRuns = useMemo(
		() => reportRunsQuery.data?.tasks ?? [],
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
				getValue: (task: (typeof reportRuns)[number]) => {
					const details = task.details?.export ?? null;
					return `Export #${task.id}\n${details?.template_name ?? task.summary ?? "Ad-hoc export"}`;
				},
			},
			{
				key: "created",
				label: "Created",
				getValue: (task: (typeof reportRuns)[number]) =>
					formatTimestamp(task.created_at),
			},
			{
				key: "status",
				label: "Status",
				getValue: (task: (typeof reportRuns)[number]) => task.status,
			},
			{
				key: "type",
				label: "Type",
				getValue: (task: (typeof reportRuns)[number]) =>
					task.details?.export?.output_content_type ?? "available",
			},
		],
		rows: reportRuns,
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
		if (
			!templatesQuery.isLoading &&
			runnableTemplates.length === 0 &&
			runMode === "template"
		) {
			setRunMode("json");
		}
	}, [runMode, runnableTemplates.length, templatesQuery.isLoading]);

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
			setRunnerError(
				error instanceof Error ? error.message : "Failed to submit export.",
			);
		},
	});

	const runTemplateMutation = useMutation({
		mutationFn: async (vars: {
			templateId: number;
			overrides: ReportTemplateRunRequest;
		}) => runTemplateReport(vars.templateId, vars.overrides),
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
			setRunnerError(
				error instanceof Error
					? error.message
					: "Failed to run template export.",
			);
		},
	});

	function openCreateTemplate() {
		router.push("/exports/templates/new");
	}

	function openEditTemplate(template: ReportTemplate) {
		router.push(`/exports/templates/${template.id}`);
	}

	function loadReportRun(task: TaskResponse) {
		setRunnerError(null);
		setResultActionFeedback(null);
		setLastResult(null);
		setLastReportTask(task);
		setActiveView("run");
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
				setRunnerError(
					"This template is related_objects-scoped; an object id is required.",
				);
				return;
			}
			overrides.object_id = parsed;
		}
		if (overridePolicy) overrides.missing_data_policy = overridePolicy;
		const oMaxItems = overrideMaxItems.trim()
			? parsePositiveInteger(overrideMaxItems)
			: null;
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

	function handleWorkspaceTabKeyDown(
		event: KeyboardEvent<HTMLButtonElement>,
		view: ExportWorkspaceView,
	) {
		const currentIndex = EXPORT_WORKSPACE_VIEWS.indexOf(view);
		let nextIndex: number | null = null;
		if (event.key === "ArrowRight") {
			nextIndex = (currentIndex + 1) % EXPORT_WORKSPACE_VIEWS.length;
		} else if (event.key === "ArrowLeft") {
			nextIndex =
				(currentIndex - 1 + EXPORT_WORKSPACE_VIEWS.length) %
				EXPORT_WORKSPACE_VIEWS.length;
		} else if (event.key === "Home") {
			nextIndex = 0;
		} else if (event.key === "End") {
			nextIndex = EXPORT_WORKSPACE_VIEWS.length - 1;
		}

		if (nextIndex === null) return;
		event.preventDefault();
		const nextView = EXPORT_WORKSPACE_VIEWS[nextIndex];
		setActiveView(nextView);
		window.setTimeout(
			() => document.getElementById(`export-tab-${nextView}`)?.focus(),
			0,
		);
	}

	const collectionOptions = collectionsQuery.data ?? [];
	const collectionHierarchy = useMemo(
		() => buildCollectionHierarchy(collectionOptions),
		[collectionOptions],
	);
	const collectionLabels = useMemo(
		() =>
			new Map(
				collectionOptions.map((collection) => [
					collection.id,
					formatCollectionOption(collection, collectionHierarchy.byId),
				]),
			),
		[collectionHierarchy.byId, collectionOptions],
	);
	const classOptions = classesQuery.data ?? [];
	const objectOptions = objectsQuery.data ?? [];
	const activeReportProgress = getTaskProgressPercent(activeReportTask);

	return (
		<section className="stack export-workspace">
			<header className="export-page-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Exports</p>
					<h2>Prepare, run, and retrieve exports</h2>
					<p className="muted">
						Start a one-off JSON export or run a reusable template, then
						download the result when it is ready.
					</p>
				</div>
				{activeView === "templates" ? (
					<button type="button" onClick={openCreateTemplate}>
						Create template
					</button>
				) : null}
			</header>

			<div
				className="export-workspace-tabs"
				role="tablist"
				aria-label="Export workspace"
			>
				<button
					type="button"
					id="export-tab-run"
					role="tab"
					aria-selected={activeView === "run"}
					aria-controls="export-panel-run"
					tabIndex={activeView === "run" ? 0 : -1}
					className={activeView === "run" ? "is-active" : ""}
					onClick={() => setActiveView("run")}
					onKeyDown={(event) => handleWorkspaceTabKeyDown(event, "run")}
				>
					<span>Run export</span>
					<small>Configure and retrieve</small>
				</button>
				<button
					type="button"
					id="export-tab-templates"
					role="tab"
					aria-selected={activeView === "templates"}
					aria-controls="export-panel-templates"
					tabIndex={activeView === "templates" ? 0 : -1}
					className={activeView === "templates" ? "is-active" : ""}
					onClick={() => setActiveView("templates")}
					onKeyDown={(event) => handleWorkspaceTabKeyDown(event, "templates")}
				>
					<span>Templates</span>
					<small>{templates.length} saved</small>
				</button>
				<button
					type="button"
					id="export-tab-history"
					role="tab"
					aria-selected={activeView === "history"}
					aria-controls="export-panel-history"
					tabIndex={activeView === "history" ? 0 : -1}
					className={activeView === "history" ? "is-active" : ""}
					onClick={() => setActiveView("history")}
					onKeyDown={(event) => handleWorkspaceTabKeyDown(event, "history")}
				>
					<span>History</span>
					<small>{reportRuns.length} recent</small>
				</button>
			</div>

			<div className="export-workspace-panel">
				{activeView === "templates" ? (
					<section
						id="export-panel-templates"
						className="stack"
						role="tabpanel"
						aria-labelledby="export-tab-templates"
					>
						<article className="card stack panel-card">
							<div className="panel-header">
								<div className="stack action-card-header">
									<h3>Template library</h3>
									<p className="muted">
										Reusable layouts and export settings, organized by
										collection.
									</p>
								</div>
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
										<button type="button" onClick={openCreateTemplate}>
											New template
										</button>
									}
								/>
							) : null}
							{templates.length ? (
								<div className="export-template-toolbar">
									<label className="control-field">
										<span>Find a template</span>
										<input
											type="search"
											value={templateSearch}
											onChange={(event) =>
												setTemplateSearch(event.target.value)
											}
											placeholder="Search name, description, scope, or format"
										/>
									</label>
									<label className="control-field">
										<span>Collection</span>
										<select
											value={templateCollectionFilter}
											onChange={(event) =>
												setTemplateCollectionFilter(event.target.value)
											}
										>
											<option value="">All collections</option>
											{collectionOptions.map((collection) => (
												<option key={collection.id} value={collection.id}>
													{collectionLabels.get(collection.id)}
												</option>
											))}
										</select>
									</label>
									<span className="muted export-template-count">
										{filteredTemplates.length} of {templates.length}
									</span>
								</div>
							) : null}

							{templates.length > 0 && filteredTemplates.length === 0 ? (
								<div className="empty-state">
									No templates match the current search and collection filter.
								</div>
							) : null}

							<div className="template-list">
								{filteredTemplates.map((template) => (
									<article
										key={template.id}
										className={`template-card ${selectedTemplateId === String(template.id) ? "template-card--selected" : ""}`}
									>
										<div className="template-card-header">
											<div className="stack template-card-copy">
												<h4>{template.name}</h4>
												<p className="template-description">
													{template.description}
												</p>
												<div className="preview-meta">
													<span>
														{collectionLabels.get(template.collection_id) ??
															`Collection #${template.collection_id}`}
													</span>
													<span>
														{formatExportContentType(template.content_type)}
													</span>
													<span>
														{template.kind === "fragment"
															? "Reusable fragment"
															: formatExportScope(template.scope_kind)}
													</span>
												</div>
											</div>
											<div className="stack template-card-side">
												<span className="template-stamp">
													Updated {formatTimestamp(template.updated_at)}
												</span>
												<div className="action-row template-card-actions">
													{template.kind === "export" ? (
														<button
															type="button"
															onClick={() => {
																setSelectedTemplateId(String(template.id));
																setRunMode("template");
																setRunnerError(null);
																setActiveView("run");
															}}
														>
															Run
														</button>
													) : null}
													<button
														type="button"
														className="ghost"
														onClick={() => openEditTemplate(template)}
													>
														Edit
													</button>
													<button
														type="button"
														className="danger"
														onClick={() => {
															if (
																!window.confirm(
																	`Delete template "${template.name}"?`,
																)
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
											</div>
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
				) : null}

				{activeView !== "templates" ? (
					<section
						id={`export-panel-${activeView}`}
						className="stack"
						role="tabpanel"
						aria-labelledby={`export-tab-${activeView}`}
					>
						{activeView === "run" ? (
							<article className="card stack panel-card">
								<div className="stack action-card-header">
									<h3>Create an export</h3>
									<p className="muted">
										{runnableTemplates.length
											? "Choose a reusable template or configure a one-off JSON export."
											: "Configure a one-off JSON export, or create a reusable template for future runs."}
									</p>
								</div>

								<div
									className={`segmented-options export-method-picker${!templatesQuery.isLoading && runnableTemplates.length === 0 ? " export-method-picker--single" : ""}`}
								>
									<button
										type="button"
										className={runMode === "json" ? "is-selected" : "ghost"}
										aria-pressed={runMode === "json"}
										onClick={() => {
											setRunMode("json");
											setRunnerError(null);
										}}
									>
										<span>Custom JSON</span>
										<small>Choose the data and filters for this run</small>
									</button>
									{templatesQuery.isLoading ? (
										<div className="export-method-loading muted">
											Checking saved templates…
										</div>
									) : runnableTemplates.length ? (
										<button
											type="button"
											className={
												runMode === "template" ? "is-selected" : "ghost"
											}
											aria-pressed={runMode === "template"}
											onClick={() => {
												setRunMode("template");
												setRunnerError(null);
											}}
										>
											<span>Saved template</span>
											<small>Use a prepared layout and defaults</small>
										</button>
									) : null}
								</div>

								{!templatesQuery.isLoading &&
								!templatesQuery.isError &&
								runnableTemplates.length === 0 ? (
									<EmptyState
										title="No saved export templates"
										description="Create a reusable template when you need formatted text, HTML, or CSV output."
										action={
											<button type="button" onClick={openCreateTemplate}>
												Create a template
											</button>
										}
									/>
								) : null}

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
													<option value="objects_in_class">
														Objects in class
													</option>
													<option value="class_relations">
														Class relations
													</option>
													<option value="object_relations">
														Object relations
													</option>
													<option value="related_objects">
														Related objects
													</option>
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
															onChange={(event) =>
																setClassId(event.target.value)
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
															id="export-class"
															type="number"
															min={1}
															value={classId}
															onChange={(event) =>
																setClassId(event.target.value)
															}
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
															onChange={(event) =>
																setObjectId(event.target.value)
															}
														>
															<option value="">Select object</option>
															{objectOptions.map((objectItem) => (
																<option
																	key={objectItem.id}
																	value={objectItem.id}
																>
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
															onChange={(event) =>
																setObjectId(event.target.value)
															}
															placeholder="Enter object ID"
														/>
													)}
												</div>
											) : null}

											<details className="export-disclosure control-field--wide">
												<summary>
													<span>Filters and sorting</span>
													<small>
														{builderFilters.length} filter
														{builderFilters.length === 1 ? "" : "s"} ·{" "}
														{builderSorts.length} sort
														{builderSorts.length === 1 ? "" : "s"}
													</small>
												</summary>
												<div className="query-builder-card export-disclosure-body">
													<div className="panel-header">
														<div className="stack action-card-header">
															<h4>Query builder</h4>
															<p className="muted">
																Available fields in the selectors below are
																limited to the current scope.
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
															<button
																type="button"
																className="ghost"
																onClick={addSort}
															>
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
																						(field) =>
																							field.key === event.target.value,
																					) ?? scopeFields[0];
																				setBuilderFilters((current) =>
																					current.map((currentFilter) =>
																						currentFilter.id === filter.id
																							? {
																									...currentFilter,
																									field: nextField.key,
																									operator:
																										getOperatorsForField(
																											nextField.kind,
																										)[0],
																								}
																							: currentFilter,
																					),
																				);
																			}}
																		>
																			{scopeFields.map((field) => (
																				<option
																					key={field.key}
																					value={field.key}
																				>
																					{formatQueryField(field.key)}
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
																					{formatQueryOperator(operator)}
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
															No filters yet. Add a filter or use the advanced
															query input.
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
																				{formatQueryField(field.key)}
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
																		<option value="asc">Ascending</option>
																		<option value="desc">Descending</option>
																	</select>
																	<button
																		type="button"
																		className="ghost"
																		onClick={() =>
																			setBuilderSorts((current) =>
																				current.filter(
																					(currentSort) =>
																						currentSort.id !== sort.id,
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
											</details>

											{scopeKind === "objects_in_class" ||
											scopeKind === "related_objects" ? (
												<details className="export-disclosure control-field--wide">
													<summary>
														<span>Related data</span>
														<small>
															{includeRows.length
																? `${includeRows.length} include${includeRows.length === 1 ? "" : "s"}`
																: "No related objects included"}
														</small>
													</summary>
													<div className="export-disclosure-body">
														<IncludeRows
															rows={includeRows}
															classOptions={classOptions}
															onAdd={addIncludeRow}
															onUpdate={updateIncludeRow}
															onRemove={removeIncludeRow}
														/>
													</div>
												</details>
											) : null}

											<details className="export-disclosure control-field--wide">
												<summary>
													<span>Advanced settings</span>
													<small>
														Limits, missing data, and relation depth
													</small>
												</summary>
												<div className="form-grid export-disclosure-body">
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
																onChange={(event) =>
																	setRelationDepth(event.target.value)
																}
																placeholder={
																	scopeKind === "related_objects"
																		? "2 (default)"
																		: "Off"
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
															onChange={(event) =>
																setMaxItems(event.target.value)
															}
														/>
													</label>

													<label className="control-field">
														<span>Maximum output size (bytes)</span>
														<input
															type="number"
															min={1}
															value={maxOutputBytes}
															onChange={(event) =>
																setMaxOutputBytes(event.target.value)
															}
														/>
														{parsePositiveInteger(maxOutputBytes) ? (
															<small className="field-note">
																{formatBytes(
																	parsePositiveInteger(maxOutputBytes) ?? 0,
																)}
															</small>
														) : null}
													</label>
												</div>
											</details>
										</div>

										{runnerError ? (
											<div className="error-banner">{runnerError}</div>
										) : null}

										<div className="export-submit-bar">
											<span className="muted">
												{formatExportScope(scopeKind)} · JSON · up to{" "}
												{maxItems || "default"} items
											</span>
											<button
												type="submit"
												disabled={runReportMutation.isPending}
											>
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
												onChange={(event) =>
													setSelectedTemplateId(event.target.value)
												}
											>
												<option value="">Select an export template</option>
												{runnableTemplates.map((template) => (
													<option key={template.id} value={template.id}>
														{template.name} (
														{formatExportContentType(template.content_type)})
													</option>
												))}
											</select>
										</label>

										{selectedTemplate ? (
											<div className="preview-meta">
												<span>
													{formatExportScope(selectedTemplate.scope_kind)}
												</span>
												{selectedTemplate.class_id != null ? (
													<span>class #{selectedTemplate.class_id}</span>
												) : null}
												{selectedTemplate.default_query ? (
													<span>
														default query: {selectedTemplate.default_query}
													</span>
												) : null}
												{selectedTemplate.relation_context?.depth != null ? (
													<span>
														depth {selectedTemplate.relation_context.depth}
													</span>
												) : null}
												<span>
													{formatExportContentType(
														selectedTemplate.content_type,
													)}
												</span>
											</div>
										) : null}

										{selectedTemplate?.scope_kind === "related_objects" ? (
											<div className="form-grid">
												<label className="control-field">
													<span>Root object</span>
													<input
														type="number"
														min={1}
														value={overrideObjectId}
														onChange={(event) =>
															setOverrideObjectId(event.target.value)
														}
														placeholder="Enter object ID"
													/>
												</label>
											</div>
										) : null}

										<details className="export-disclosure">
											<summary>
												<span>Override template defaults</span>
												<small>Query, missing data, and output limits</small>
											</summary>
											<div className="form-grid export-disclosure-body">
												<label className="control-field control-field--wide">
													<span>Query override</span>
													<input
														value={overrideQuery}
														onChange={(event) =>
															setOverrideQuery(event.target.value)
														}
														placeholder={
															selectedTemplate?.default_query ??
															"Use template default"
														}
													/>
												</label>

												<label className="control-field">
													<span>Override missing data policy</span>
													<select
														value={overridePolicy}
														onChange={(event) =>
															setOverridePolicy(
																event.target.value as
																	| ReportMissingDataPolicy
																	| "",
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
														onChange={(event) =>
															setOverrideMaxItems(event.target.value)
														}
														placeholder="template default"
													/>
												</label>

												<label className="control-field">
													<span>Maximum output size override (bytes)</span>
													<input
														type="number"
														min={1}
														value={overrideMaxOutputBytes}
														onChange={(event) =>
															setOverrideMaxOutputBytes(event.target.value)
														}
														placeholder="template default"
													/>
													{parsePositiveInteger(overrideMaxOutputBytes) ? (
														<small className="field-note">
															{formatBytes(
																parsePositiveInteger(overrideMaxOutputBytes) ??
																	0,
															)}
														</small>
													) : null}
												</label>
											</div>
										</details>

										{runnerError ? (
											<div className="error-banner">{runnerError}</div>
										) : null}

										<div className="export-submit-bar">
											<span className="muted">
												{selectedTemplate
													? `${selectedTemplate.name} · ${formatExportContentType(selectedTemplate.content_type)}`
													: "Select a template to continue"}
											</span>
											<button
												type="submit"
												disabled={
													runTemplateMutation.isPending || !selectedTemplate
												}
											>
												{runTemplateMutation.isPending
													? "Submitting..."
													: "Run template"}
											</button>
										</div>
									</form>
								) : null}
							</article>
						) : null}

						{activeView === "history" ? (
							<article className="card stack panel-card">
								<div className="panel-header">
									<div className="stack action-card-header">
										<h3>Recent export runs</h3>
										<p className="muted">
											Review every recent outcome and retrieve output while it
											is still stored.
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
								reportRuns.length === 0 ? (
									<div className="empty-state">
										No recent export runs found.
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
								{reportRuns.length ? (
									<div className="table-wrap">
										<table className="export-history-table">
											<thead>
												<tr>
													<th>Run</th>
													<th>Created</th>
													<th>Status</th>
													<th>Type</th>
													<th>
														<span className="sr-only">Actions</span>
													</th>
												</tr>
											</thead>
											<tbody>
												{reportRuns.map((task) => {
													const taskReportDetails =
														task.details?.export ?? null;
													const isActionPending = reportRunActionId === task.id;
													const hasOutput =
														taskReportDetails?.output_available === true;
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
															<td>
																<span
																	className={`status-pill status-pill--${getTaskStatusTone(task.status)}`}
																>
																	{task.status.replaceAll("_", " ")}
																</span>
															</td>
															<td>
																{taskReportDetails?.output_content_type
																	? formatExportContentType(
																			taskReportDetails.output_content_type,
																		)
																	: "—"}
															</td>
															<td>
																<div className="action-row">
																	{hasOutput ? (
																		<>
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
																				onClick={() => downloadReportRun(task)}
																				disabled={isActionPending}
																			>
																				Download
																			</button>
																		</>
																	) : null}
																	<Link
																		className="link-chip"
																		href={`/tasks/${task.id}`}
																	>
																		Details
																	</Link>
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
						) : null}

						{activeView === "run" ? (
							<article className="card stack panel-card">
								<div className="panel-header">
									<div className="stack action-card-header">
										<h3>Latest result</h3>
										<p className="muted">
											Progress and output for the export you most recently
											started or opened from History.
										</p>
									</div>
								</div>

								{activeReportTask ? (
									<div className="preview-meta">
										<span>Task #{activeReportTask.id}</span>
										<span
											className={`status-pill status-pill--${getTaskStatusTone(activeReportTask.status)}`}
										>
											{activeReportTask.status.replaceAll("_", " ")}
										</span>
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
												Output expires{" "}
												{formatTimestamp(reportDetails.output_expires_at)}
											</span>
										) : null}
									</div>
								) : null}

								{activeReportTask ? (
									<div
										className="export-progress"
										role="progressbar"
										aria-label="Export progress"
										aria-valuemin={0}
										aria-valuemax={100}
										aria-valuenow={activeReportProgress}
									>
										<span style={{ width: `${activeReportProgress}%` }} />
									</div>
								) : null}

								{activeReportTask &&
								!isTerminalTaskStatus(activeReportTask.status) ? (
									<div className="info-banner">
										Export task is {activeReportTask.status}. This page is
										polling for completion.
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
									<EmptyState
										title="No export selected"
										description="Run an export above, or open one from History to preview its output here."
									/>
								) : null}
								{lastResult && lastResultView ? (
									<div className="stack">
										<div className="result-toolbar">
											<div className="preview-meta">
												<span>
													{formatExportContentType(lastResult.contentType)}
												</span>
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
															`export-${activeReportTask?.id ?? scopeKind}`,
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
															copyReportText(
																lastResultView.previewText,
																"Preview",
															)
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
															copyReportText(
																lastResultView.fullText,
																"Full result",
															)
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
												{formatBytes(lastResultView.previewBytes)}. Use download
												for the full payload.
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
						) : null}
					</section>
				) : null}
			</div>
		</section>
	);
}
