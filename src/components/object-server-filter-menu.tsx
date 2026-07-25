"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
	getObjectServerFilterIdentity,
	getObjectServerFilterLabel,
	MAX_OBJECT_COMPUTED_FILTERS,
	MAX_OBJECT_SERVER_FILTERS,
	normalizeObjectServerFilter,
	resolveObjectServerFilterRelativeDates,
	type ObjectServerFilterDataType,
	type ObjectServerFilter,
	type ObjectServerFilterBaseOperator,
	type ObjectServerFilterOperator,
} from "@/lib/object-server-filters";
import type {
	ServerFilterComputedField,
	ServerFilterDataField,
} from "@/lib/object-server-filter-fields";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

export type {
	ServerFilterComputedField,
	ServerFilterDataField,
} from "@/lib/object-server-filter-fields";

type ObjectServerFilterMenuProps = {
	filters: readonly ObjectServerFilter[];
	dataFields: readonly ServerFilterDataField[];
	computedFields: readonly ServerFilterComputedField[];
	onChange: (filters: ObjectServerFilter[]) => void;
	disabled?: boolean;
	embeddedInForm?: boolean;
};

type OperatorOption = {
	value: ObjectServerFilterBaseOperator;
	label: string;
};

type SelectableDataType = Exclude<
	ObjectServerFilterDataType,
	"unknown" | "object"
>;

const DATA_TYPE_OPTIONS: Array<{
	value: SelectableDataType;
	label: string;
}> = [
	{ value: "string", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "boolean", label: "True / false" },
	{ value: "date", label: "Date / time" },
	{ value: "ip", label: "IP / network" },
	{ value: "array", label: "Array" },
];

const STRING_OPERATORS: OperatorOption[] = [
	{ value: "icontains", label: "contains (ignore case)" },
	{ value: "iequals", label: "equals (ignore case)" },
	{ value: "contains", label: "contains" },
	{ value: "equals", label: "equals" },
	{ value: "istartswith", label: "starts with" },
	{ value: "iendswith", label: "ends with" },
];

const NUMBER_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals" },
	{ value: "gte", label: "at least" },
	{ value: "lte", label: "at most" },
	{ value: "gt", label: "greater than" },
	{ value: "lt", label: "less than" },
];

const DATA_STRING_OPERATORS: OperatorOption[] = [
	...STRING_OPERATORS,
	{ value: "like", label: "matches SQL pattern" },
	{ value: "regex", label: "matches regular expression" },
	{ value: "in", label: "is one of (comma-separated)" },
	{ value: "is_null", label: "is missing or null" },
];
const DATA_NUMBER_OPERATORS: OperatorOption[] = [
	...NUMBER_OPERATORS,
	{ value: "between", label: "is between (min,max)" },
	{ value: "in", label: "is one of (comma-separated)" },
	{ value: "is_null", label: "is missing or null" },
];
const DATA_DATE_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals" },
	{ value: "lt", label: "is before" },
	{ value: "lte", label: "is on or before" },
	{ value: "gt", label: "is after" },
	{ value: "gte", label: "is on or after" },
	{ value: "between", label: "is between (start,end)" },
	{ value: "in", label: "is one of (comma-separated)" },
	{ value: "is_null", label: "is missing or null" },
];
const DATA_BOOLEAN_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals" },
	{ value: "is_null", label: "is missing or null" },
];
const DATA_IP_OPERATORS: OperatorOption[] = [
	{ value: "inet_equals", label: "equals (normalized address/network)" },
	{ value: "within_network", label: "is within network" },
	{ value: "contains_network", label: "contains address/network" },
	{ value: "contains_ip", label: "strictly contains host IP" },
	{ value: "overlaps_network", label: "overlaps network" },
	{ value: "is_null", label: "is missing or null" },
];
const DATA_ARRAY_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals JSON" },
	{ value: "in", label: "contains any (comma-separated)" },
	{ value: "all", label: "contains all (comma-separated)" },
	{ value: "array_length", label: "has length" },
	{ value: "is_null", label: "is missing or null" },
];
const DATA_OBJECT_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals JSON" },
	{ value: "has_key", label: "has key" },
	{ value: "is_null", label: "is missing or null" },
];

const COMPUTED_STRING_OPERATORS: OperatorOption[] = [
	...STRING_OPERATORS,
	{ value: "like", label: "matches SQL pattern" },
	{ value: "regex", label: "matches regular expression" },
	{ value: "in", label: "is one of (comma-separated)" },
	{ value: "is_null", label: "is unavailable or null" },
];
const COMPUTED_NUMBER_OPERATORS: OperatorOption[] = [
	...NUMBER_OPERATORS,
	{ value: "in", label: "is one of (comma-separated)" },
	{ value: "between", label: "is between (min,max)" },
	{ value: "is_null", label: "is unavailable or null" },
];
const COMPUTED_BOOLEAN_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals" },
	{ value: "is_null", label: "is unavailable or null" },
];
const COMPUTED_OBJECT_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals JSON" },
	{ value: "contains", label: "contains JSON" },
	{ value: "has_key", label: "has key" },
	{ value: "is_null", label: "is unavailable or null" },
];
const COMPUTED_ARRAY_OPERATORS: OperatorOption[] = [
	{ value: "equals", label: "equals JSON" },
	{ value: "contains", label: "contains JSON" },
	{ value: "has_key", label: "contains string" },
	{ value: "array_length", label: "has length" },
	{ value: "is_null", label: "is unavailable or null" },
];

function getDataOperatorOptions(
	dataType: ObjectServerFilterDataType,
): OperatorOption[] {
	if (dataType === "number") return DATA_NUMBER_OPERATORS;
	if (dataType === "boolean") return DATA_BOOLEAN_OPERATORS;
	if (dataType === "date") return DATA_DATE_OPERATORS;
	if (dataType === "ip") return DATA_IP_OPERATORS;
	if (dataType === "array") return DATA_ARRAY_OPERATORS;
	if (dataType === "object") return DATA_OBJECT_OPERATORS;
	return DATA_STRING_OPERATORS;
}

function getDataTypeLabel(dataType: ObjectServerFilterDataType): string | null {
	if (dataType === "date") return "date/time";
	if (dataType === "ip") return "IP/network";
	if (dataType === "unknown") return null;
	return dataType;
}

function IconServerFilter() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M4 6h16M7 12h10m-7 6h4"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.8"
			/>
		</svg>
	);
}

export function ObjectServerFilterMenu({
	filters,
	dataFields,
	computedFields,
	onChange,
	disabled = false,
	embeddedInForm = false,
}: ObjectServerFilterMenuProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const fieldInputId = useId();
	const valueInputId = useId();
	const dataTypeInputName = useId();
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const fieldRef = useRef<HTMLSelectElement | null>(null);
	const [isOpen, setOpen] = useState(false);
	const [field, setField] = useState("name");
	const [operator, setOperator] =
		useState<ObjectServerFilterBaseOperator>("icontains");
	const [value, setValue] = useState("");
	const [datePickerValues, setDatePickerValues] = useState<
		readonly [string, string]
	>(["", ""]);
	const [dateInputMode, setDateInputMode] = useState<"picker" | "text">(
		"picker",
	);
	const [negated, setNegated] = useState(false);
	const [dataTypeOverrides, setDataTypeOverrides] = useState<
		Record<string, SelectableDataType>
	>({});
	const dataFieldById = useMemo(
		() => new Map(dataFields.map((item) => [item.id, item])),
		[dataFields],
	);
	const selectedDataField = field.startsWith("data:")
		? dataFieldById.get(field.slice(5))
		: undefined;
	const detectedDataType =
		selectedDataField?.dataType === "unknown" ||
		selectedDataField?.dataType === "object"
			? "string"
			: selectedDataField?.dataType;
	const selectedDataType = selectedDataField
		? (dataTypeOverrides[selectedDataField.id] ?? detectedDataType)
		: undefined;
	const computedFieldById = useMemo(
		() => new Map(computedFields.map((item) => [item.id, item])),
		[computedFields],
	);
	const selectedComputedField = field.startsWith("computed:")
		? computedFieldById.get(field.slice("computed:".length))
		: undefined;
	const isNumberField =
		field === "id" ||
		field === "collection_id" ||
		selectedDataType === "number" ||
		selectedComputedField?.resultType === "number" ||
		selectedComputedField?.resultType === "integer";
	const operatorOptions = useMemo(() => {
		if (selectedDataType) {
			return getDataOperatorOptions(selectedDataType);
		}
		if (!selectedComputedField) {
			return isNumberField ? NUMBER_OPERATORS : STRING_OPERATORS;
		}
		if (
			selectedComputedField.resultType === "number" ||
			selectedComputedField.resultType === "integer"
		) {
			return COMPUTED_NUMBER_OPERATORS;
		}
		if (selectedComputedField.resultType === "boolean") {
			return COMPUTED_BOOLEAN_OPERATORS;
		}
		if (selectedComputedField.resultType === "object") {
			return COMPUTED_OBJECT_OPERATORS;
		}
		if (selectedComputedField.resultType === "array") {
			return COMPUTED_ARRAY_OPERATORS;
		}
		return COMPUTED_STRING_OPERATORS;
	}, [isNumberField, selectedComputedField, selectedDataType]);
	const expectsNoValue = Boolean(selectedDataField) && operator === "is_null";
	const expectsBooleanValue =
		!expectsNoValue &&
		(operator === "is_null" ||
			selectedDataType === "boolean" ||
			selectedComputedField?.resultType === "boolean");
	const computedFilterCount = filters.filter(
		(filter) => filter.field === "computed",
	).length;

	useEffect(() => {
		if (!operatorOptions.some((option) => option.value === operator)) {
			setOperator(operatorOptions[0].value);
		}
	}, [operator, operatorOptions]);

	useEffect(() => {
		if (expectsNoValue) {
			if (value) setValue("");
			return;
		}
		if (expectsBooleanValue && value !== "true" && value !== "false") {
			setValue("true");
		}
	}, [expectsBooleanValue, expectsNoValue, value]);

	useEffect(() => {
		if (!isOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
		};
	}, [isOpen]);
	useEscapeToCancel({
		enabled: isOpen,
		onCancel: () => closeMenu({ restoreFocus: true }),
	});

	const draftFilter = useMemo<ObjectServerFilter | null>(() => {
		const effectiveOperator =
			`${negated ? "not_" : ""}${operator}` as ObjectServerFilterOperator;
		const dataField = field.startsWith("data:")
			? dataFieldById.get(field.slice(5))
			: undefined;
		if (dataField) {
			return normalizeObjectServerFilter({
				field: "json_data",
				operator: effectiveOperator,
				value,
				path: dataField.path,
			});
		}
		if (selectedComputedField) {
			return normalizeObjectServerFilter({
				field: "computed",
				operator: effectiveOperator,
				value,
				computedScope: selectedComputedField.scope,
				computedKey: selectedComputedField.key,
				computedResultType: selectedComputedField.resultType,
			});
		}
		if (field.startsWith("data:") || field.startsWith("computed:")) {
			return null;
		}
		return normalizeObjectServerFilter({
			field: field as "name" | "description" | "id" | "collection_id",
			operator: effectiveOperator,
			value,
		});
	}, [dataFieldById, field, negated, operator, selectedComputedField, value]);
	const computedLimitReached =
		Boolean(selectedComputedField) &&
		computedFilterCount >= MAX_OBJECT_COMPUTED_FILTERS;

	useEffect(() => {
		if (field.startsWith("data:") && !dataFieldById.has(field.slice(5))) {
			setField("name");
			setOperator("icontains");
		}
	}, [dataFieldById, field]);

	useEffect(() => {
		if (
			field.startsWith("computed:") &&
			!computedFieldById.has(field.slice("computed:".length))
		) {
			setField("name");
			setOperator("icontains");
		}
	}, [computedFieldById, field]);

	function openMenu() {
		setOpen(true);
		window.setTimeout(() => fieldRef.current?.focus(), 0);
	}

	function closeMenu({ restoreFocus = false } = {}) {
		setOpen(false);
		if (restoreFocus) {
			window.setTimeout(() => triggerRef.current?.focus(), 0);
		}
	}

	function addFilter(event?: { preventDefault(): void }) {
		event?.preventDefault();
		if (!draftFilter || computedLimitReached) return;
		const resolvedDraftFilter =
			draftFilter.field === "json_data" && selectedDataType === "date"
				? normalizeObjectServerFilter({
						...draftFilter,
						value: resolveObjectServerFilterRelativeDates(draftFilter.value),
					})
				: draftFilter;
		if (!resolvedDraftFilter) return;
		const identity = getObjectServerFilterIdentity(resolvedDraftFilter);
		const next = filters.filter(
			(item) => getObjectServerFilterIdentity(item) !== identity,
		);
		onChange([...next, resolvedDraftFilter].slice(-MAX_OBJECT_SERVER_FILTERS));
		setValue("");
		setDatePickerValues(["", ""]);
	}

	function updateDatePickerValue(index: 0 | 1, nextValue: string) {
		setDatePickerValues((current) =>
			index === 0 ? [nextValue, current[1]] : [current[0], nextValue],
		);
		if (!nextValue) return;
		const parsed = new Date(nextValue);
		if (!Number.isFinite(parsed.getTime())) return;
		const resolved = parsed.toISOString();
		if (operator !== "between") {
			setValue(resolved);
			return;
		}
		const currentParts = value.split(",", 2);
		if (index === 0) {
			setValue(`${resolved},${currentParts[1] ?? ""}`);
		} else {
			setValue(`${currentParts[0] ?? ""},${resolved}`);
		}
	}

	function updateOperator(nextOperator: ObjectServerFilterBaseOperator) {
		if (selectedDataType === "date") {
			if (nextOperator === "is_null") {
				setDatePickerValues(["", ""]);
			} else if (operator === "between" && nextOperator !== "between") {
				setValue(value.split(",", 2)[0] ?? "");
				setDatePickerValues((current) => [current[0], ""]);
			} else if (
				operator !== "between" &&
				nextOperator === "between" &&
				value
			) {
				setValue(`${value},`);
			}
		}
		setOperator(nextOperator);
	}

	function updateDateInputMode(nextMode: "picker" | "text") {
		if (nextMode === dateInputMode) return;
		if (nextMode === "picker") {
			setValue("");
			setDatePickerValues(["", ""]);
		}
		setDateInputMode(nextMode);
	}
	const FilterControlsContainer = embeddedInForm ? "div" : "form";

	return (
		<div className="server-filter" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="ghost server-filter-trigger"
				disabled={disabled}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				onClick={() => (isOpen ? closeMenu() : openMenu())}
			>
				<IconServerFilter />
				<span>Server filters</span>
				{filters.length > 0 ? (
					<span className="server-filter-count">{filters.length}</span>
				) : null}
			</button>
			{isOpen ? (
				<div
					className="server-filter-menu card"
					role="dialog"
					aria-label="Server filters"
				>
					<div className="server-filter-menu-header">
						<div>
							<strong>Query the full class</strong>
							<p>Filters are applied by the server and combined with AND.</p>
						</div>
						{filters.length > 0 ? (
							<button
								type="button"
								className="ghost"
								onClick={() => onChange([])}
							>
								Clear all
							</button>
						) : null}
					</div>
					{filters.length > 0 ? (
						<div className="server-filter-active">
							{filters.map((filter, index) => (
								<div
									className="server-filter-chip"
									key={getObjectServerFilterIdentity(filter)}
								>
									<span>
										<strong>{getObjectServerFilterLabel(filter)}</strong>{" "}
										{filter.operator.replaceAll("_", " ")}
										{filter.field === "json_data" &&
										filter.operator.endsWith("is_null")
											? ""
											: ` “${filter.value}”`}
									</span>
									<button
										type="button"
										className="ghost"
										aria-label={`Remove ${getObjectServerFilterLabel(filter)} filter`}
										onClick={() =>
											onChange(
												filters.filter((_, itemIndex) => itemIndex !== index),
											)
										}
									>
										×
									</button>
								</div>
							))}
						</div>
					) : null}
					<FilterControlsContainer
						className="server-filter-form"
						onSubmit={embeddedInForm ? undefined : addFilter}
					>
						<div className="server-filter-field">
							<label htmlFor={fieldInputId}>
								<span>Field</span>
							</label>
							<select
								id={fieldInputId}
								ref={fieldRef}
								aria-label="Server filter field"
								value={field}
								onChange={(event) => {
									setField(event.target.value);
									setValue("");
									setDatePickerValues(["", ""]);
									setDateInputMode("picker");
								}}
							>
								<optgroup label="Object">
									<option value="name">Name</option>
									<option value="description">Description</option>
									<option value="id">ID</option>
									<option value="collection_id">Collection ID</option>
								</optgroup>
								{dataFields.length > 0 ? (
									<optgroup label="Data fields">
										{dataFields.map((item) => (
											<option key={item.id} value={`data:${item.id}`}>
												{item.label}
												{getDataTypeLabel(item.dataType)
													? ` · ${getDataTypeLabel(item.dataType)}`
													: ""}
											</option>
										))}
									</optgroup>
								) : null}
								{computedFields.length > 0 ? (
									<optgroup label="Computed fields">
										{computedFields.map((item) => (
											<option key={item.id} value={`computed:${item.id}`}>
												{item.scope === "shared" ? "Shared" : "Personal"} ·{" "}
												{item.label}
											</option>
										))}
									</optgroup>
								) : null}
							</select>
						</div>
						{selectedDataField && selectedDataType ? (
							<fieldset className="server-filter-data-types">
								<legend>
									Interpret as
									<small>
										Detected{" "}
										{getDataTypeLabel(selectedDataField.dataType) ?? "unknown"}
									</small>
								</legend>
								<div className="server-filter-data-type-options">
									{DATA_TYPE_OPTIONS.map((option) => (
										<label
											className="server-filter-data-type-option"
											key={option.value}
										>
											<input
												type="radio"
												name={dataTypeInputName}
												value={option.value}
												checked={selectedDataType === option.value}
												onChange={() => {
													setDataTypeOverrides((current) => ({
														...current,
														[selectedDataField.id]: option.value,
													}));
													setValue("");
													setDatePickerValues(["", ""]);
													setDateInputMode("picker");
												}}
											/>
											<span>{option.label}</span>
										</label>
									))}
								</div>
							</fieldset>
						) : null}
						<label>
							<span>Match</span>
							<select
								aria-label="Server filter operator"
								value={operator}
								onChange={(event) =>
									updateOperator(
										event.target.value as ObjectServerFilterBaseOperator,
									)
								}
							>
								{operatorOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<div className="server-filter-value">
							<label htmlFor={valueInputId}>
								<span>Value</span>
							</label>
							{expectsNoValue ? (
								<input
									id={valueInputId}
									aria-label="Server filter value"
									value="No value needed"
									disabled
								/>
							) : expectsBooleanValue ? (
								<select
									id={valueInputId}
									aria-label="Server filter value"
									value={value || "true"}
									onChange={(event) => setValue(event.target.value)}
								>
									<option value="true">True</option>
									<option value="false">False</option>
								</select>
							) : selectedDataType === "date" && dateInputMode === "picker" ? (
								<div className="server-filter-date-pickers">
									<input
										id={valueInputId}
										type="datetime-local"
										step="1"
										aria-label={
											operator === "between"
												? "Pick start date and time"
												: "Pick date and time"
										}
										value={datePickerValues[0]}
										onChange={(event) =>
											updateDatePickerValue(0, event.target.value)
										}
									/>
									{operator === "between" ? (
										<input
											type="datetime-local"
											step="1"
											aria-label="Pick end date and time"
											value={datePickerValues[1]}
											onChange={(event) =>
												updateDatePickerValue(1, event.target.value)
											}
										/>
									) : null}
								</div>
							) : (
								<input
									id={valueInputId}
									aria-label="Server filter value"
									type={
										(isNumberField || operator === "array_length") &&
										!["in", "between"].includes(operator)
											? "number"
											: "text"
									}
									value={value}
									onChange={(event) => {
										setValue(event.target.value);
										if (selectedDataType === "date") {
											setDatePickerValues(["", ""]);
										}
									}}
									placeholder={
										operator === "between"
											? selectedDataType === "date"
												? "-4y,now"
												: "10,20"
											: operator === "in"
												? selectedDataType === "date"
													? "-4y,now"
													: "one,two,three"
												: selectedDataType === "date"
													? "-4y or 2021-07-24T00:00:00Z"
													: selectedDataType === "ip"
														? "10.0.0.0/24"
														: operator === "has_key"
															? "hostname"
															: selectedComputedField?.resultType === "object"
																? '{"status":"active"}'
																: selectedComputedField?.resultType === "array"
																	? '["active"]'
																	: isNumberField
																		? "42"
																		: "Enter a value"
									}
								/>
							)}
							{selectedDataType === "date" && !expectsNoValue ? (
								<fieldset className="server-filter-date-mode">
									<legend className="sr-only">Date input mode</legend>
									<button
										type="button"
										className={`ghost ${dateInputMode === "picker" ? "is-selected" : ""}`}
										aria-pressed={dateInputMode === "picker"}
										onClick={() => updateDateInputMode("picker")}
									>
										Calendar
									</button>
									<button
										type="button"
										className={`ghost ${dateInputMode === "text" ? "is-selected" : ""}`}
										aria-pressed={dateInputMode === "text"}
										onClick={() => updateDateInputMode("text")}
									>
										Relative / RFC3339
									</button>
								</fieldset>
							) : null}
						</div>
						<label className="server-filter-negate">
							<input
								type="checkbox"
								checked={negated}
								onChange={(event) => setNegated(event.target.checked)}
							/>
							<span>Exclude matches</span>
						</label>
						<button
							type={embeddedInForm ? "button" : "submit"}
							onClick={embeddedInForm ? addFilter : undefined}
							disabled={
								!draftFilter ||
								computedLimitReached ||
								filters.length >= MAX_OBJECT_SERVER_FILTERS
							}
						>
							Add filter
						</button>
					</FilterControlsContainer>
					{computedLimitReached ? (
						<p className="server-filter-footnote">
							The server accepts at most {MAX_OBJECT_COMPUTED_FILTERS} computed
							filters per query.
						</p>
					) : null}
					{selectedDataType === "date" &&
					dateInputMode === "text" &&
					!expectsNoValue ? (
						<p className="server-filter-footnote">
							Relative dates are resolved when added: <code>-4y</code>,{" "}
							<code>-6mo</code>, <code>-2w</code>, <code>-30d</code>,{" "}
							<code>-12h</code>, <code>-15m</code>, <code>-30s</code>, or{" "}
							<code>now</code>. RFC3339 timestamps and calendar dates also work.
						</p>
					) : null}
					{selectedDataType === "date" &&
					dateInputMode === "picker" &&
					!expectsNoValue ? (
						<p className="server-filter-footnote">
							Calendar selections use your local timezone and are stored as
							RFC3339.
						</p>
					) : null}
					{selectedDataType === "ip" ? (
						<p className="server-filter-footnote">
							Network comparisons accept IPv4 or IPv6 addresses and CIDR
							networks.
						</p>
					) : null}
					{dataFields.length === 0 ? (
						<p className="server-filter-footnote">
							Data fields appear here when the class schema or loaded rows
							expose them.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
