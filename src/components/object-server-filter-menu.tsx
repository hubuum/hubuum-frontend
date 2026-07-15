"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	getObjectServerFilterIdentity,
	getObjectServerFilterLabel,
	MAX_OBJECT_SERVER_FILTERS,
	type ObjectServerFilter,
	type ObjectServerFilterOperator,
} from "@/lib/object-server-filters";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

export type ServerFilterDataField = {
	id: string;
	label: string;
	path: string[];
};

type ObjectServerFilterMenuProps = {
	filters: readonly ObjectServerFilter[];
	dataFields: readonly ServerFilterDataField[];
	onChange: (filters: ObjectServerFilter[]) => void;
	disabled?: boolean;
};

const STRING_OPERATORS: Array<{
	value: ObjectServerFilterOperator;
	label: string;
}> = [
	{ value: "icontains", label: "contains (ignore case)" },
	{ value: "iequals", label: "equals (ignore case)" },
	{ value: "contains", label: "contains" },
	{ value: "equals", label: "equals" },
	{ value: "istartswith", label: "starts with" },
	{ value: "iendswith", label: "ends with" },
];

const NUMBER_OPERATORS: Array<{
	value: ObjectServerFilterOperator;
	label: string;
}> = [
	{ value: "equals", label: "equals" },
	{ value: "gte", label: "at least" },
	{ value: "lte", label: "at most" },
	{ value: "gt", label: "greater than" },
	{ value: "lt", label: "less than" },
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
	onChange,
	disabled = false,
}: ObjectServerFilterMenuProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const fieldRef = useRef<HTMLSelectElement | null>(null);
	const [isOpen, setOpen] = useState(false);
	const [field, setField] = useState("name");
	const [operator, setOperator] =
		useState<ObjectServerFilterOperator>("icontains");
	const [value, setValue] = useState("");
	const isNumberField = field === "id" || field === "collection_id";
	const operatorOptions = isNumberField ? NUMBER_OPERATORS : STRING_OPERATORS;

	useEffect(() => {
		if (!operatorOptions.some((option) => option.value === operator)) {
			setOperator(operatorOptions[0].value);
		}
	}, [operator, operatorOptions]);

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

	useEffect(() => {
		if (field.startsWith("data:") && !dataFieldById.has(field.slice(5))) {
			setField("name");
			setOperator("icontains");
		}
	}, [dataFieldById, field]);

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
		const trimmedValue = value.trim();
		if (!trimmedValue) return;

		const dataField = field.startsWith("data:")
			? dataFieldById.get(field.slice(5))
			: undefined;
		if (field.startsWith("data:") && !dataField) {
			setField("name");
			setOperator("icontains");
			return;
		}
		const nextFilter: ObjectServerFilter = dataField
			? {
					field: "json_data",
					operator,
					value: trimmedValue,
					path: dataField.path,
				}
			: {
					field: field as "name" | "description" | "id" | "collection_id",
					operator,
					value: trimmedValue,
				};
		const identity = getObjectServerFilterIdentity(nextFilter);
		const next = filters.filter(
			(item) => getObjectServerFilterIdentity(item) !== identity,
		);
		onChange([...next, nextFilter].slice(-MAX_OBJECT_SERVER_FILTERS));
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
				<div className="server-filter-menu card" role="dialog" aria-label="Server filters">
					<div className="server-filter-menu-header">
						<div>
							<strong>Query the full class</strong>
							<p>Filters are applied by the server and combined with AND.</p>
						</div>
						{filters.length > 0 ? (
							<button type="button" className="ghost" onClick={() => onChange([])}>
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
										onClick={() => onChange(filters.filter((_, itemIndex) => itemIndex !== index))}
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
							</select>
						</label>
						<label>
							<span>Match</span>
							<select
								aria-label="Server filter operator"
								value={operator}
								onChange={(event) =>
									setOperator(event.target.value as ObjectServerFilterOperator)
								}
							>
								{operatorOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<label className="server-filter-value">
							<span>Value</span>
							<input
								aria-label="Server filter value"
								type={isNumberField ? "number" : "text"}
								value={value}
								onChange={(event) => setValue(event.target.value)}
								placeholder={isNumberField ? "42" : "Enter a value"}
							/>
						</label>
						<button
							type="submit"
							disabled={!value.trim() || filters.length >= MAX_OBJECT_SERVER_FILTERS}
						>
							Add filter
						</button>
					</form>
					{dataFields.length === 0 ? (
						<p className="server-filter-footnote">
							Data fields appear here when the class schema or loaded rows expose them.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
