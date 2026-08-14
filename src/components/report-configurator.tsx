"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { ObjectDirectoryLookup } from "@/components/object-directory-lookup";
import { ReportQueryBuilder } from "@/components/report-query-builder";
import {
	CLASS_OBJECT_SAMPLES_GC_TIME,
	CLASS_OBJECT_SAMPLES_STALE_TIME,
	classObjectSamplesQueryKey,
	fetchClassObjectSamples,
} from "@/lib/api/class-objects";
import {
	fetchPersonalComputedFields,
	fetchSharedComputedFields,
} from "@/lib/api/computed-fields";
import { fetchExportClasses } from "@/lib/api/export-options";
import { fetchClassObjectDirectory } from "@/lib/api/resource-directory";
import type { ReportMissingDataPolicy } from "@/lib/api/reporting";
import { getReportTemplate } from "@/lib/api/reporting";
import {
	EXPORT_ACTION_HINTS,
	formatExportContentType,
	formatExportScope,
	getBookmarkableReportHref,
	getReportConfigurationHref,
	getReportRefreshHref,
} from "@/lib/export-workspace";
import {
	resolveObjectServerFilterComputedFields,
	resolveObjectServerFilterDataFields,
} from "@/lib/object-server-filter-fields";
import { parsePositiveInteger } from "@/lib/number-input";
import {
	buildBookmarkableReportOverrides,
	type ReportConfiguratorValues,
} from "@/lib/report-configuration";
import { useDebouncedValue } from "@/lib/use-debounced-value";

type PreparedReport = {
	href: string;
	refreshHref: string;
};

function templateLimit(
	value: number | null | undefined,
	fallback: string,
): string {
	return value == null ? fallback : String(value);
}

function openNewTab(href: string) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.target = "_blank";
	anchor.rel = "noopener noreferrer";
	anchor.click();
}

export function ReportConfigurator({
	initialQueryOverride,
	initialValues,
	templateId,
}: {
	initialQueryOverride: boolean;
	initialValues: ReportConfiguratorValues;
	templateId: number;
}) {
	const router = useRouter();
	const [values, setValues] = useState<ReportConfiguratorValues>(initialValues);
	const [queryOverrideEnabled, setQueryOverrideEnabled] =
		useState(initialQueryOverride);
	const [preparedReport, setPreparedReport] = useState<PreparedReport | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<string | null>(null);
	const [objectSearch, setObjectSearch] = useState("");
	const templateQuery = useQuery({
		queryKey: ["export-template", templateId],
		queryFn: () => getReportTemplate(templateId),
	});
	const template = templateQuery.data ?? null;
	const objectSearchTerm = objectSearch.trim();
	const objectSearchMinimum = /^\d+$/.test(objectSearchTerm) ? 1 : 2;
	const debouncedObjectSearchTerm = useDebouncedValue(objectSearchTerm, 300);
	const objectSearchIsReady =
		objectSearchTerm.length >= objectSearchMinimum &&
		debouncedObjectSearchTerm === objectSearchTerm;
	const objectDirectoryQuery = useQuery({
		queryKey: [
			"report-object-directory",
			template?.class_id ?? null,
			debouncedObjectSearchTerm,
		],
		queryFn: () =>
			fetchClassObjectDirectory(
				template?.class_id ?? 0,
				debouncedObjectSearchTerm,
			),
		enabled:
			template?.scope_kind === "related_objects" &&
			template.class_id != null &&
			objectSearchIsReady,
		retry: false,
		staleTime: 5 * 60 * 1000,
	});
	const usesObjectServerFilters =
		template?.scope_kind === "objects_in_class" && template.class_id != null;
	const classesQuery = useQuery({
		queryKey: ["classes", "report-configurator"],
		queryFn: fetchExportClasses,
		enabled: usesObjectServerFilters,
	});
	const selectedClass = useMemo(
		() =>
			classesQuery.data?.find(
				(classItem) => classItem.id === template?.class_id,
			) ?? null,
		[classesQuery.data, template?.class_id],
	);
	const classObjectSamplesQuery = useQuery({
		queryKey: classObjectSamplesQueryKey(selectedClass?.id ?? null),
		queryFn: () => fetchClassObjectSamples(selectedClass?.id ?? 0),
		enabled: usesObjectServerFilters && selectedClass != null,
		staleTime: CLASS_OBJECT_SAMPLES_STALE_TIME,
		gcTime: CLASS_OBJECT_SAMPLES_GC_TIME,
	});
	const sharedComputedQuery = useQuery({
		queryKey: ["computed-fields", "shared", selectedClass?.id ?? null],
		queryFn: () => fetchSharedComputedFields(selectedClass?.id ?? 0),
		enabled: usesObjectServerFilters && selectedClass != null,
	});
	const personalComputedQuery = useQuery({
		queryKey: ["computed-fields", "personal", selectedClass?.id ?? null],
		queryFn: () => fetchPersonalComputedFields(selectedClass?.id ?? 0),
		enabled: usesObjectServerFilters && selectedClass != null,
	});
	const objectSampleData = useMemo(
		() =>
			(classObjectSamplesQuery.data ?? []).map((objectItem) => objectItem.data),
		[classObjectSamplesQuery.data],
	);
	const objectServerFilterDataFields = useMemo(
		() =>
			resolveObjectServerFilterDataFields(
				selectedClass?.json_schema,
				objectSampleData,
			),
		[objectSampleData, selectedClass?.json_schema],
	);
	const objectServerFilterComputedFields = useMemo(
		() =>
			resolveObjectServerFilterComputedFields(
				sharedComputedQuery.data?.definitions ?? [],
				personalComputedQuery.data ?? [],
			),
		[personalComputedQuery.data, sharedComputedQuery.data?.definitions],
	);
	const templateDefaults = useMemo(() => {
		if (!template) {
			return null;
		}
		return {
			maxItems: templateLimit(
				template.default_limits?.max_items,
				"backend default",
			),
			maxOutputBytes: templateLimit(
				template.default_limits?.max_output_bytes,
				"backend default",
			),
			missingDataPolicy:
				template.default_missing_data_policy ?? "backend default",
			query: template.default_query || "No saved filters",
		};
	}, [template]);
	const initialObjectId = useMemo(() => {
		return parsePositiveInteger(initialValues.objectId);
	}, [initialValues.objectId]);
	const canUseSavedDefaults =
		template?.scope_kind !== "related_objects" || initialObjectId !== null;
	const savedReportHref =
		template && canUseSavedDefaults
			? getBookmarkableReportHref(template.id, {
					object_id:
						template.scope_kind === "related_objects" ? initialObjectId : null,
				})
			: null;
	const savedRefreshHref =
		template && canUseSavedDefaults
			? getReportRefreshHref(template.id, {
					object_id:
						template.scope_kind === "related_objects" ? initialObjectId : null,
				})
			: null;

	function updateValue<Key extends keyof ReportConfiguratorValues>(
		key: Key,
		value: ReportConfiguratorValues[Key],
	) {
		setValues((current) => ({ ...current, [key]: value }));
		setPreparedReport(null);
		setError(null);
		setFeedback(null);
	}

	function prepareCurrentReport(): PreparedReport | null {
		if (!template) {
			return null;
		}
		try {
			const overrides = buildBookmarkableReportOverrides(
				values,
				template,
				queryOverrideEnabled,
			);
			const next = {
				href: getBookmarkableReportHref(template.id, overrides),
				refreshHref: getReportRefreshHref(template.id, overrides),
			};
			setPreparedReport(next);
			setError(null);
			router.replace(getReportConfigurationHref(template.id, overrides), {
				scroll: false,
			});
			return next;
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: "The report configuration is invalid.",
			);
			return null;
		}
	}

	function viewWithChanges(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const report = prepareCurrentReport();
		if (!report) {
			return;
		}
		openNewTab(report.href);
		setFeedback("Opened the configured report in a new tab.");
	}

	function refreshWithChanges() {
		const report = prepareCurrentReport();
		if (!report) {
			return;
		}
		openNewTab(report.refreshHref);
		setFeedback(
			"Generating a fresh result. The new tab will finish on the clean bookmark URL.",
		);
	}

	async function copyBookmark() {
		const report = prepareCurrentReport();
		if (!report) {
			return;
		}
		try {
			await navigator.clipboard.writeText(
				new URL(report.href, window.location.origin).toString(),
			);
			setFeedback("Customized report link copied.");
		} catch {
			setFeedback("Could not copy automatically. Use the prepared link below.");
		}
	}

	function resetConfiguration() {
		const emptyValues: ReportConfiguratorValues = {
			maxAge: "",
			maxItems: "",
			maxOutputBytes: "",
			missingDataPolicy: "",
			objectId: "",
			query: "",
		};
		setValues(emptyValues);
		setQueryOverrideEnabled(false);
		setObjectSearch("");
		setPreparedReport(null);
		setError(null);
		setFeedback("Restored the saved template defaults.");
		router.replace(`/exports/reports/${templateId}`, { scroll: false });
	}

	if (templateQuery.isLoading) {
		return (
			<section className="card panel-card">
				<p className="muted">Loading report…</p>
			</section>
		);
	}

	if (templateQuery.isError || !template) {
		return (
			<section className="card stack panel-card">
				<h2>Report unavailable</h2>
				<div className="error-banner">
					{templateQuery.error instanceof Error
						? templateQuery.error.message
						: "Failed to load this export template."}
				</div>
				<Link className="link-chip" href="/exports">
					Back to reports
				</Link>
			</section>
		);
	}

	if (template.kind !== "export") {
		return (
			<section className="card stack panel-card">
				<h2>{template.name}</h2>
				<div className="empty-state">
					This is a reusable fragment, not an executable report.
				</div>
				<div className="action-row">
					<Link
						className="link-chip link-chip--primary"
						href={`/exports/templates/${template.id}`}
					>
						Edit fragment
					</Link>
					<Link className="link-chip" href="/exports?view=templates">
						Back to templates
					</Link>
				</div>
			</section>
		);
	}

	return (
		<section className="stack report-configurator-page">
			<header className="card report-configurator-command">
				<div className="stack action-card-header">
					<p className="eyebrow">Exports · Reports · Run with changes</p>
					<h2>{template.name}</h2>
					<p className="muted">{template.description}</p>
					<div className="preview-meta">
						<span>{formatExportContentType(template.content_type)}</span>
						<span>{formatExportScope(template.scope_kind)}</span>
						<span>
							Template updated {new Date(template.updated_at).toLocaleString()}
						</span>
					</div>
				</div>
				<div className="action-row report-configurator-command-actions">
					<Link className="link-chip" href="/exports">
						Back to reports
					</Link>
					<Link
						className="link-chip action-hint"
						data-action-hint={EXPORT_ACTION_HINTS.editTemplate}
						href={`/exports/templates/${template.id}`}
					>
						Edit template
					</Link>
					<Link
						className="link-chip action-hint"
						data-action-hint={EXPORT_ACTION_HINTS.duplicate}
						href={`/exports/templates/new?from=${template.id}`}
					>
						Duplicate
					</Link>
				</div>
			</header>

			<article className="card report-default-run-card">
				<div className="stack action-card-header">
					<p className="eyebrow">Saved defaults</p>
					<h3>Open the report as designed</h3>
					<p className="muted">
						The stable link reuses the latest available result and regenerates
						when its stored output is no longer available.
					</p>
				</div>
				<div className="action-row">
					{savedReportHref ? (
						<>
							<Link
								className="link-chip link-chip--primary action-hint"
								data-action-hint={EXPORT_ACTION_HINTS.viewSaved}
								href={savedReportHref}
								target="_blank"
								rel="noopener noreferrer"
								prefetch={false}
							>
								View report
							</Link>
							{savedRefreshHref ? (
								<Link
									className="link-chip action-hint"
									data-action-hint={EXPORT_ACTION_HINTS.refresh}
									href={savedRefreshHref}
									target="_blank"
									rel="noopener noreferrer"
									prefetch={false}
								>
									Refresh now
								</Link>
							) : null}
						</>
					) : (
						<span className="field-note">
							This report needs a root object. Choose it below.
						</span>
					)}
				</div>
			</article>

			<form
				className="card stack report-configurator-controls"
				onSubmit={viewWithChanges}
			>
				<div className="panel-header">
					<div className="stack action-card-header">
						<p className="eyebrow">Optional</p>
						<h3>Run with changes</h3>
						<p className="muted">
							Change this view without modifying the saved template.
						</p>
					</div>
					<button type="button" className="ghost" onClick={resetConfiguration}>
						Reset
					</button>
				</div>

				{template.scope_kind === "related_objects" ? (
					<div className="control-field report-root-object-field">
						<label htmlFor="report-root-object">Root object ID</label>
						<div className="directory-id-lookup-control">
							<input
								id="report-root-object"
								type="number"
								min={1}
								value={values.objectId}
								onChange={(event) => {
									setObjectSearch("");
									updateValue("objectId", event.target.value);
								}}
								placeholder="Required"
							/>
							<ObjectDirectoryLookup
								disabled={template.class_id == null}
								disabledHint="This template does not specify a class"
								helperText={
									objectSearchTerm.length < objectSearchMinimum
										? "Type at least two characters, or enter an exact object ID."
										: objectDirectoryQuery.isLoading || !objectSearchIsReady
											? "Searching objects visible to your account…"
											: objectDirectoryQuery.isError
												? "Object lookup is unavailable; enter an exact object ID."
												: objectDirectoryQuery.data?.isPartial
													? "More than 50 objects match; type more to narrow the results."
													: objectDirectoryQuery.data?.items.length === 0
														? "No matching objects are visible in this class."
														: "Choose an object to fill Root object ID."
								}
								idPrefix="report-root-object"
								objects={objectDirectoryQuery.data?.items ?? []}
								onChange={setObjectSearch}
								onSelect={(objectItem) => {
									setObjectSearch(objectItem.name);
									updateValue("objectId", String(objectItem.id));
								}}
								value={objectSearch}
							/>
						</div>
					</div>
				) : null}

				<fieldset className="report-query-choice">
					<legend>Query</legend>
					<label>
						<input
							type="radio"
							name="report-query-mode"
							checked={!queryOverrideEnabled}
							onChange={() => {
								setQueryOverrideEnabled(false);
								updateValue("query", "");
							}}
						/>
						<span>
							<strong>Use the saved query</strong>
							<small>{templateDefaults?.query}</small>
						</span>
					</label>
					<label>
						<input
							type="radio"
							name="report-query-mode"
							checked={queryOverrideEnabled}
							onChange={() => {
								setQueryOverrideEnabled(true);
								updateValue("query", template.default_query ?? "");
							}}
						/>
						<span>
							<strong>Change it for this view</strong>
							<small>Use the same visual builder as template authoring.</small>
						</span>
					</label>
				</fieldset>

				{queryOverrideEnabled ? (
					<ReportQueryBuilder
						idPrefix="report-override-query"
						scopeKind={template.scope_kind ?? "objects_in_class"}
						value={values.query}
						onChange={(query) => updateValue("query", query)}
						heading="Filters and sorting for this view"
						description="Start from the saved query, then make only the changes needed for this run."
						emptyMessage="No filters in this override."
						objectDataFields={objectServerFilterDataFields}
						objectComputedFields={objectServerFilterComputedFields}
						objectFiltersDisabled={
							usesObjectServerFilters && selectedClass == null
						}
						objectFilterHint={
							classesQuery.isLoading
								? "Loading the template’s class fields…"
								: classObjectSamplesQuery.isLoading
									? "Inspecting a cached object sample for nested fields and value types…"
									: "Open Server filters to add or edit full-class filters using the same fields available in template authoring."
						}
					/>
				) : null}

				<label className="control-field report-freshness-field">
					<span>Maximum result age</span>
					<input
						list="report-max-age-options"
						value={values.maxAge}
						onChange={(event) => updateValue("maxAge", event.target.value)}
						placeholder="Use latest until backend expiry"
					/>
					<datalist id="report-max-age-options">
						<option value="5m" />
						<option value="15m" />
						<option value="1h" />
						<option value="6h" />
						<option value="1d" />
					</datalist>
					<small className="field-note">
						Use seconds or s/m/h/d. Leave blank to reuse the latest stored
						result. “Refresh now” is the one-time force action.
					</small>
				</label>

				<details className="export-disclosure">
					<summary>
						<span>Advanced run rules</span>
						<small>Missing data and output limits</small>
					</summary>
					<div className="form-grid export-disclosure-body">
						<label className="control-field control-field--wide">
							<span>Missing data policy</span>
							<select
								value={values.missingDataPolicy}
								onChange={(event) =>
									updateValue(
										"missingDataPolicy",
										event.target.value as ReportMissingDataPolicy | "",
									)
								}
							>
								<option value="">
									Template default ({templateDefaults?.missingDataPolicy})
								</option>
								<option value="strict">Strict</option>
								<option value="null">Use null</option>
								<option value="omit">Omit missing values</option>
							</select>
						</label>
						<label className="control-field">
							<span>Maximum items</span>
							<input
								type="number"
								min={0}
								value={values.maxItems}
								onChange={(event) =>
									updateValue("maxItems", event.target.value)
								}
								placeholder={templateDefaults?.maxItems}
							/>
						</label>
						<label className="control-field">
							<span>Maximum output bytes</span>
							<input
								type="number"
								min={0}
								value={values.maxOutputBytes}
								onChange={(event) =>
									updateValue("maxOutputBytes", event.target.value)
								}
								placeholder={templateDefaults?.maxOutputBytes}
							/>
						</label>
					</div>
				</details>

				{error ? (
					<div className="error-banner" role="alert">
						{error}
					</div>
				) : null}

				<div className="report-configurator-form-actions">
					<button
						type="submit"
						className="action-hint"
						data-action-hint={EXPORT_ACTION_HINTS.viewCustomized}
					>
						View with changes
					</button>
					<button
						type="button"
						className="ghost action-hint"
						data-action-hint={EXPORT_ACTION_HINTS.refreshCustomized}
						onClick={refreshWithChanges}
					>
						Refresh now
					</button>
					<button
						type="button"
						className="ghost action-hint"
						data-action-hint={EXPORT_ACTION_HINTS.copyCustomizedLink}
						onClick={copyBookmark}
					>
						Copy customized link
					</button>
				</div>

				{preparedReport ? (
					<p className="field-note">
						<Link
							href={preparedReport.href}
							target="_blank"
							rel="noopener noreferrer"
							prefetch={false}
						>
							Open the prepared report
						</Link>
						{" · "}
						This clean URL is safe to bookmark.
					</p>
				) : null}
				<p className="field-note" aria-live="polite">
					{feedback ??
						"Permanent target, hydration, layout, and default changes belong in Edit template."}
				</p>
			</form>
		</section>
	);
}
