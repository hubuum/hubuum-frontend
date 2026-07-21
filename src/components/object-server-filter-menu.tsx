"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
	getObjectServerFilterIdentity,
	getObjectServerFilterLabel,
	MAX_OBJECT_COMPUTED_FILTERS,
	MAX_OBJECT_SERVER_FILTERS,
	normalizeObjectServerFilter,
	type ObjectComputedResultType,
	type ObjectComputedFilterScope,
	type ObjectServerFilter,
	type ObjectServerFilterBaseOperator,
	type ObjectServerFilterOperator,
} from "@/lib/object-server-filters";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

export type ServerFilterDataField = {
	id: string;
	label: string;
	path: string[];
};

export type ServerFilterComputedField = {
	id: string;
	key: string;
	label: string;
	scope: ObjectComputedFilterScope;
	resultType: ObjectComputedResultType;
};

type ObjectServerFilterMenuProps = {
	filters: readonly ObjectServerFilter[];
	dataFields: readonly ServerFilterDataField[];
	computedFields: readonly ServerFilterComputedField[];
	onChange: (filters: ObjectServerFilter[]) => void;
	disabled?: boolean;
};

type OperatorOption = {
	value: ObjectServerFilterBaseOperator;
	label: string;
};

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
}: ObjectServerFilterMenuProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const valueInputId = useId();
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const fieldRef = useRef<HTMLSelectElement | null>(null);
	const [isOpen, setOpen] = useState(false);
	const [field, setField] = useState("name");
	const [operator, setOperator] =
		useState<ObjectServerFilterBaseOperator>("icontains");
	const [value, setValue] = useState("");
	const [negated, setNegated] = useState(false);
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
		selectedComputedField?.resultType === "number" ||
		selectedComputedField?.resultType === "integer";
	const operatorOptions = useMemo(() => {
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
	}, [isNumberField, selectedComputedField]);
	const expectsBooleanValue =
		operator === "is_null" || selectedComputedField?.resultType === "boolean";
	const computedFilterCount = filters.filter(
		(filter) => filter.field === "computed",
	).length;

	useEffect(() => {
		if (!operatorOptions.some((option) => option.value === operator)) {
			setOperator(operatorOptions[0].value);
		}
	}, [operator, operatorOptions]);

	useEffect(() => {
		if (expectsBooleanValue && value !== "true" && value !== "false") {
			setValue("true");
		}
	}, [expectsBooleanValue, value]);

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

	const dataFieldById = useMemo(
		() => new Map(dataFields.map((item) => [item.id, item])),
		[dataFields],
	);
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

	function addFilter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!draftFilter || computedLimitReached) return;
		const identity = getObjectServerFilterIdentity(draftFilter);
		const next = filters.filter(
			(item) => getObjectServerFilterIdentity(item) !== identity,
		);
		onChange([...next, draftFilter].slice(-MAX_OBJECT_SERVER_FILTERS));
		setValue("");
	}

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
										{filter.operator.replaceAll("_", " ")} “{filter.value}”
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
					<form className="server-filter-form" onSubmit={addFilter}>
						<label>
							<span>Field</span>
							<select
								ref={fieldRef}
								aria-label="Server filter field"
								value={field}
								onChange={(event) => setField(event.target.value)}
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
						</label>
						<label>
							<span>Match</span>
							<select
								aria-label="Server filter operator"
								value={operator}
								onChange={(event) =>
									setOperator(
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
						<label className="server-filter-value" htmlFor={valueInputId}>
							<span>Value</span>
							{expectsBooleanValue ? (
								<select
									id={valueInputId}
									aria-label="Server filter value"
									value={value || "true"}
									onChange={(event) => setValue(event.target.value)}
								>
									<option value="true">True</option>
									<option value="false">False</option>
								</select>
							) : (
								<input
									id={valueInputId}
									aria-label="Server filter value"
									type={
										isNumberField && !["in", "between"].includes(operator)
											? "number"
											: "text"
									}
									value={value}
									onChange={(event) => setValue(event.target.value)}
									placeholder={
										operator === "between"
											? "10,20"
											: operator === "in"
												? "one,two,three"
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
						</label>
						<label className="server-filter-negate">
							<input
								type="checkbox"
								checked={negated}
								onChange={(event) => setNegated(event.target.checked)}
							/>
							<span>Exclude matches</span>
						</label>
						<button
							type="submit"
							disabled={
								!draftFilter ||
								computedLimitReached ||
								filters.length >= MAX_OBJECT_SERVER_FILTERS
							}
						>
							Add filter
						</button>
					</form>
					{computedLimitReached ? (
						<p className="server-filter-footnote">
							The server accepts at most {MAX_OBJECT_COMPUTED_FILTERS} computed
							filters per query.
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
