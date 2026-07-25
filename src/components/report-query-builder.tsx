"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	ObjectServerFilterMenu,
	type ServerFilterComputedField,
	type ServerFilterDataField,
} from "@/components/object-server-filter-menu";
import type { ReportScopeKind } from "@/lib/api/reporting";
import type { ObjectServerFilter } from "@/lib/object-server-filters";
import {
	buildObjectReportQuery,
	buildReportQuery,
	formatReportQueryField,
	formatReportQueryOperator,
	getReportQueryOperators,
	parseObjectReportQuery,
	parseReportQuery,
	type ReportQueryFilter,
	type ReportQuerySort,
} from "@/lib/report-query";
import { SCOPE_QUERY_FIELDS } from "@/lib/report-scope-fields";

type BuilderFilter = ReportQueryFilter & { id: number };
type BuilderSort = ReportQuerySort & { id: number };

type ReportQueryBuilderProps = {
	idPrefix: string;
	scopeKind: ReportScopeKind;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	objectComputedFields?: readonly ServerFilterComputedField[];
	objectDataFields?: readonly ServerFilterDataField[];
	objectFiltersDisabled?: boolean;
	objectFilterHint?: string;
};

function withIds<T extends object>(
	items: readonly T[],
): Array<T & { id: number }> {
	return items.map((item, index) => ({ ...item, id: index + 1 }));
}

export function ReportQueryBuilder({
	idPrefix,
	scopeKind,
	value,
	onChange,
	disabled = false,
	objectComputedFields = [],
	objectDataFields = [],
	objectFiltersDisabled = false,
	objectFilterHint,
}: ReportQueryBuilderProps) {
	const fields = useMemo(() => SCOPE_QUERY_FIELDS[scopeKind], [scopeKind]);
	const sortableFields = useMemo(
		() => fields.filter((field) => field.sortable),
		[fields],
	);
	const usesObjectServerFilters = scopeKind === "objects_in_class";
	const parsedInitialRef = useRef<{
		filters: ReportQueryFilter[];
		objectFilters: ObjectServerFilter[];
		sorts: ReportQuerySort[];
		advancedQuery: string;
	} | null>(null);
	if (parsedInitialRef.current == null) {
		if (usesObjectServerFilters) {
			const parsed = parseObjectReportQuery(
				value,
				fields,
				objectComputedFields,
			);
			parsedInitialRef.current = {
				filters: [],
				objectFilters: parsed.filters,
				sorts: parsed.sorts,
				advancedQuery: parsed.advancedQuery,
			};
		} else {
			const parsed = parseReportQuery(value, fields);
			parsedInitialRef.current = {
				filters: parsed.filters,
				objectFilters: [],
				sorts: parsed.sorts,
				advancedQuery: parsed.advancedQuery,
			};
		}
	}
	const parsedInitial = parsedInitialRef.current;
	const [filters, setFilters] = useState<BuilderFilter[]>(() =>
		withIds(parsedInitial.filters),
	);
	const [objectFilters, setObjectFilters] = useState<ObjectServerFilter[]>(
		parsedInitial.objectFilters,
	);
	const [sorts, setSorts] = useState<BuilderSort[]>(() =>
		withIds(parsedInitial.sorts),
	);
	const [advancedQuery, setAdvancedQuery] = useState(
		parsedInitial.advancedQuery,
	);
	const nextIdRef = useRef(filters.length + sorts.length + 1);
	const lastEmittedValueRef = useRef(value);
	const previousScopeRef = useRef(scopeKind);
	const computedFieldSignature = objectComputedFields
		.map((field) => `${field.scope}:${field.key}:${field.resultType}`)
		.join("|");
	const previousComputedFieldSignatureRef = useRef(computedFieldSignature);

	const emit = useCallback(
		function emit(
			nextFilters: readonly BuilderFilter[],
			nextObjectFilters: readonly ObjectServerFilter[],
			nextSorts: readonly BuilderSort[],
			nextAdvancedQuery: string,
		) {
			const nextValue = usesObjectServerFilters
				? buildObjectReportQuery(
						nextObjectFilters,
						nextSorts,
						nextAdvancedQuery,
					)
				: buildReportQuery(nextFilters, nextSorts, nextAdvancedQuery);
			lastEmittedValueRef.current = nextValue;
			onChange(nextValue);
		},
		[onChange, usesObjectServerFilters],
	);

	useEffect(() => {
		const scopeChanged = previousScopeRef.current !== scopeKind;
		const computedFieldsChanged =
			previousComputedFieldSignatureRef.current !== computedFieldSignature;
		const valueChanged = value !== lastEmittedValueRef.current;
		if (!scopeChanged && !computedFieldsChanged && !valueChanged) return;

		previousScopeRef.current = scopeKind;
		previousComputedFieldSignatureRef.current = computedFieldSignature;

		if (usesObjectServerFilters) {
			const parsed = parseObjectReportQuery(
				value,
				fields,
				objectComputedFields,
			);
			const nextSorts = withIds(parsed.sorts);
			nextIdRef.current = nextSorts.length + 1;
			setFilters([]);
			setObjectFilters(parsed.filters);
			setSorts(nextSorts);
			setAdvancedQuery(parsed.advancedQuery);
			if (scopeChanged) {
				emit([], parsed.filters, nextSorts, parsed.advancedQuery);
			} else {
				lastEmittedValueRef.current = value;
			}
			return;
		}

		const parsed = parseReportQuery(value, fields);
		const nextFilters = withIds(parsed.filters);
		const nextSorts = withIds(parsed.sorts);
		nextIdRef.current = nextFilters.length + nextSorts.length + 1;
		setFilters(nextFilters);
		setObjectFilters([]);
		setSorts(nextSorts);
		setAdvancedQuery(parsed.advancedQuery);
		if (scopeChanged) {
			emit(nextFilters, [], nextSorts, parsed.advancedQuery);
		} else {
			lastEmittedValueRef.current = value;
		}
	}, [
		computedFieldSignature,
		emit,
		fields,
		objectComputedFields,
		scopeKind,
		usesObjectServerFilters,
		value,
	]);

	function updateFilters(nextFilters: BuilderFilter[]) {
		setFilters(nextFilters);
		emit(nextFilters, objectFilters, sorts, advancedQuery);
	}

	function updateObjectFilters(nextObjectFilters: ObjectServerFilter[]) {
		setObjectFilters(nextObjectFilters);
		emit(filters, nextObjectFilters, sorts, advancedQuery);
	}

	function updateSorts(nextSorts: BuilderSort[]) {
		setSorts(nextSorts);
		emit(filters, objectFilters, nextSorts, advancedQuery);
	}

	function updateAdvancedQuery(nextAdvancedQuery: string) {
		setAdvancedQuery(nextAdvancedQuery);
		emit(filters, objectFilters, sorts, nextAdvancedQuery);
	}

	function addFilter() {
		const field = fields[0];
		if (!field) return;
		updateFilters([
			...filters,
			{
				id: nextIdRef.current++,
				field: field.key,
				operator: getReportQueryOperators(field.kind)[0],
				value: "",
			},
		]);
	}

	function addSort() {
		const field = sortableFields[0];
		if (!field) return;
		updateSorts([
			...sorts,
			{ id: nextIdRef.current++, field: field.key, direction: "asc" },
		]);
	}

	return (
		<div className="query-builder-card export-template-query-builder">
			<div className="panel-header">
				<div className="stack action-card-header">
					<h4>Default filters and sorting</h4>
					<p className="muted">
						Build the query visually. Unsupported parameters remain in Advanced.
					</p>
				</div>
				<div className="action-row">
					{usesObjectServerFilters ? (
						<ObjectServerFilterMenu
							filters={objectFilters}
							dataFields={objectDataFields}
							computedFields={objectComputedFields}
							onChange={updateObjectFilters}
							disabled={disabled || objectFiltersDisabled}
							embeddedInForm
						/>
					) : (
						<button
							type="button"
							className="ghost"
							onClick={addFilter}
							disabled={disabled}
						>
							Add filter
						</button>
					)}
					<button
						type="button"
						className="ghost"
						onClick={addSort}
						disabled={disabled}
					>
						Add sort
					</button>
				</div>
			</div>

			{usesObjectServerFilters ? (
				<p className="muted">
					{objectFilterHint ??
						"Open Server filters to add or review filters for the full selected class."}
				</p>
			) : filters.length ? (
				<div className="stack query-builder-list">
					{filters.map((filter, index) => {
						const fieldDefinition =
							fields.find((field) => field.key === filter.field) ?? fields[0];
						const operatorOptions = getReportQueryOperators(
							fieldDefinition.kind,
						);
						const rowPrefix = `${idPrefix}-filter-${filter.id}`;
						return (
							<article key={filter.id} className="query-builder-row-card">
								<div className="query-builder-row-heading">
									<strong>Filter {index + 1}</strong>
									<button
										type="button"
										className="ghost compact-button"
										onClick={() =>
											updateFilters(
												filters.filter((item) => item.id !== filter.id),
											)
										}
										disabled={disabled}
									>
										Remove
									</button>
								</div>
								<div className="query-builder-row-fields">
									<label
										className="control-field"
										htmlFor={`${rowPrefix}-field`}
									>
										<span>Field</span>
										<select
											id={`${rowPrefix}-field`}
											value={filter.field}
											onChange={(event) => {
												const nextField =
													fields.find(
														(field) => field.key === event.target.value,
													) ?? fields[0];
												updateFilters(
													filters.map((item) =>
														item.id === filter.id
															? {
																	...item,
																	field: nextField.key,
																	operator: getReportQueryOperators(
																		nextField.kind,
																	)[0],
																}
															: item,
													),
												);
											}}
											disabled={disabled}
										>
											{fields.map((field) => (
												<option key={field.key} value={field.key}>
													{formatReportQueryField(field.key)}
												</option>
											))}
										</select>
									</label>
									<label
										className="control-field"
										htmlFor={`${rowPrefix}-operator`}
									>
										<span>Condition</span>
										<select
											id={`${rowPrefix}-operator`}
											value={filter.operator}
											onChange={(event) =>
												updateFilters(
													filters.map((item) =>
														item.id === filter.id
															? { ...item, operator: event.target.value }
															: item,
													),
												)
											}
											disabled={disabled}
										>
											{operatorOptions.map((operator) => (
												<option key={operator} value={operator}>
													{formatReportQueryOperator(operator)}
												</option>
											))}
										</select>
									</label>
									<label
										className="control-field"
										htmlFor={`${rowPrefix}-value`}
									>
										<span>Value</span>
										<input
											id={`${rowPrefix}-value`}
											value={filter.value}
											onChange={(event) =>
												updateFilters(
													filters.map((item) =>
														item.id === filter.id
															? { ...item, value: event.target.value }
															: item,
													),
												)
											}
											placeholder={
												filter.operator === "between" ? "min,max" : "Value"
											}
											disabled={disabled}
										/>
									</label>
								</div>
							</article>
						);
					})}
				</div>
			) : (
				<div className="empty-state">No default filters.</div>
			)}

			{sorts.length ? (
				<div className="stack query-builder-list">
					{sorts.map((sort, index) => {
						const rowPrefix = `${idPrefix}-sort-${sort.id}`;
						return (
							<article
								key={sort.id}
								className="query-builder-row-card query-builder-row-card--sort"
							>
								<div className="query-builder-row-heading">
									<strong>Sort {index + 1}</strong>
									<button
										type="button"
										className="ghost compact-button"
										onClick={() =>
											updateSorts(sorts.filter((item) => item.id !== sort.id))
										}
										disabled={disabled}
									>
										Remove
									</button>
								</div>
								<div className="query-builder-row-fields query-builder-row-fields--sort">
									<label
										className="control-field"
										htmlFor={`${rowPrefix}-field`}
									>
										<span>Field</span>
										<select
											id={`${rowPrefix}-field`}
											value={sort.field}
											onChange={(event) =>
												updateSorts(
													sorts.map((item) =>
														item.id === sort.id
															? { ...item, field: event.target.value }
															: item,
													),
												)
											}
											disabled={disabled}
										>
											{sortableFields.map((field) => (
												<option key={field.key} value={field.key}>
													{formatReportQueryField(field.key)}
												</option>
											))}
										</select>
									</label>
									<label
										className="control-field"
										htmlFor={`${rowPrefix}-direction`}
									>
										<span>Direction</span>
										<select
											id={`${rowPrefix}-direction`}
											value={sort.direction}
											onChange={(event) =>
												updateSorts(
													sorts.map((item) =>
														item.id === sort.id
															? {
																	...item,
																	direction: event.target.value as
																		| "asc"
																		| "desc",
																}
															: item,
													),
												)
											}
											disabled={disabled}
										>
											<option value="asc">Ascending</option>
											<option value="desc">Descending</option>
										</select>
									</label>
								</div>
							</article>
						);
					})}
				</div>
			) : null}

			<details className="export-disclosure">
				<summary>
					<span>Advanced query parameters</span>
					<small>
						{advancedQuery ? "Custom parameters present" : "Optional"}
					</small>
				</summary>
				<div className="stack export-disclosure-body">
					<label
						className="control-field control-field--wide"
						htmlFor={`${idPrefix}-advanced`}
					>
						<span>Parameters</span>
						<textarea
							id={`${idPrefix}-advanced`}
							value={advancedQuery}
							onChange={(event) => updateAdvancedQuery(event.target.value)}
							placeholder="permissions__contains=ReadClass"
							disabled={disabled}
						/>
					</label>
				</div>
			</details>

			<div className="generated-query-preview">
				<span className="muted">Generated query</span>
				<code>{value || "No default query"}</code>
			</div>
		</div>
	);
}
