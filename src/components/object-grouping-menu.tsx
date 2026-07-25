"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ObjectAggregateMeasureOperation } from "@/lib/api/generated/models";
import type { ObjectAggregateMeasure } from "@/lib/api/object-aggregates";
import type { ObjectGroupSort } from "@/lib/object-grouping";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

export type ObjectGroupingFieldSection =
	| "Object fields"
	| "Data fields"
	| "Custom fields"
	| "Computed fields";

export type ObjectGroupingField = {
	id: string;
	label: string;
	section: ObjectGroupingFieldSection;
	serverGroupBy?: string;
};

export type ObjectAggregateMeasureField = {
	field: string;
	id: string;
	label: string;
	section: Extract<
		ObjectGroupingFieldSection,
		"Data fields" | "Computed fields"
	>;
};

export type ObjectAggregateMeasureSelection = ObjectAggregateMeasure & {
	id: string;
};

type ObjectGroupingMenuProps = {
	fields: readonly ObjectGroupingField[];
	fieldId: string | null;
	measureFields: readonly ObjectAggregateMeasureField[];
	measures: readonly ObjectAggregateMeasureSelection[];
	sort: ObjectGroupSort;
	onFieldChange: (fieldId: string | null) => void;
	onMeasuresChange: (measures: ObjectAggregateMeasureSelection[]) => void;
	onSortChange: (sort: ObjectGroupSort) => void;
	disabled?: boolean;
};

const FIELD_SECTIONS: ObjectGroupingFieldSection[] = [
	"Object fields",
	"Data fields",
	"Custom fields",
	"Computed fields",
];

const SORT_OPTIONS: Array<{ value: ObjectGroupSort; label: string }> = [
	{ value: "count-desc", label: "Count, high to low" },
	{ value: "count-asc", label: "Count, low to high" },
	{ value: "value-asc", label: "Group value, A–Z" },
	{ value: "value-desc", label: "Group value, Z–A" },
];

const MEASURE_OPERATIONS: Array<{
	value: ObjectAggregateMeasureOperation;
	label: string;
}> = [
	{ value: "sum", label: "Sum" },
	{ value: "average", label: "Average" },
	{ value: "min", label: "Minimum" },
	{ value: "max", label: "Maximum" },
];

function IconGroup() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M5 6h5v5H5zM14 6h5v5h-5zM5 15h5v4H5zM14 15h5v4h-5z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function ObjectGroupingMenu({
	fields,
	fieldId,
	measureFields,
	measures,
	sort,
	onFieldChange,
	onMeasuresChange,
	onSortChange,
	disabled = false,
}: ObjectGroupingMenuProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const fieldRef = useRef<HTMLSelectElement | null>(null);
	const [isOpen, setOpen] = useState(false);
	const fieldsBySection = useMemo(
		() =>
			FIELD_SECTIONS.map((section) => ({
				section,
				fields: fields.filter((field) => field.section === section),
			})).filter((entry) => entry.fields.length > 0),
		[fields],
	);
	const selectedField = fields.find((field) => field.id === fieldId) ?? null;
	const usesServerAggregation =
		Boolean(selectedField?.serverGroupBy) || measures.length > 0;
	const canConfigureMeasures =
		selectedField === null || Boolean(selectedField.serverGroupBy);
	const activeCount = (selectedField ? 1 : 0) + measures.length;

	function addMeasure() {
		const field = measureFields[0];
		if (!field || measures.length >= 4 || !canConfigureMeasures) {
			return;
		}
		onMeasuresChange([
			...measures,
			{
				field: field.field,
				id: crypto.randomUUID(),
				operation: "sum",
			},
		]);
	}

	function updateMeasure(
		index: number,
		patch: Partial<ObjectAggregateMeasure>,
	) {
		onMeasuresChange(
			measures.map((measure, measureIndex) =>
				measureIndex === index ? { ...measure, ...patch } : measure,
			),
		);
	}

	function clearAggregation() {
		onFieldChange(null);
		onMeasuresChange([]);
	}

	useEffect(() => {
		if (!isOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen]);
	useEscapeToCancel({
		enabled: isOpen,
		onCancel: () => {
			setOpen(false);
			window.setTimeout(() => triggerRef.current?.focus(), 0);
		},
	});

	function toggleMenu() {
		if (isOpen) {
			setOpen(false);
			return;
		}
		setOpen(true);
		window.setTimeout(() => fieldRef.current?.focus(), 0);
	}

	return (
		<div className="object-grouping" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="ghost object-grouping-trigger"
				disabled={disabled || fields.length === 0}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				onClick={toggleMenu}
			>
				<IconGroup />
				<span>Aggregate</span>
				{activeCount > 0 ? (
					<span className="object-grouping-active">
						<span className="sr-only">Aggregate selections: </span>
						{activeCount}
					</span>
				) : null}
			</button>
			{isOpen ? (
				<div
					className="object-grouping-menu card"
					role="dialog"
					aria-label="Group objects"
				>
					<div className="object-grouping-menu-header">
						<div>
							<strong>Aggregate matching objects</strong>
							<p>
								{usesServerAggregation
									? "Counts and measures are permission-aware and calculated by the server."
									: selectedField
										? "Custom fallback fields are calculated from the current fetched page."
										: "Choose a group or numeric measure across the full filtered class."}
							</p>
						</div>
						{activeCount > 0 ? (
							<button
								type="button"
								className="ghost"
								onClick={clearAggregation}
							>
								Clear
							</button>
						) : null}
					</div>
					<label className="control-field">
						<span>Group by</span>
						<select
							ref={fieldRef}
							value={selectedField?.id ?? ""}
							onChange={(event) => onFieldChange(event.target.value || null)}
						>
							<option value="">No grouping</option>
							{fieldsBySection.map((entry) => (
								<optgroup key={entry.section} label={entry.section}>
									{entry.fields.map((field) => (
										<option key={field.id} value={field.id}>
											{field.label}
										</option>
									))}
								</optgroup>
							))}
						</select>
					</label>
					<div className="object-aggregate-measures">
						<div className="object-aggregate-measures-header">
							<div>
								<strong>Numeric measures</strong>
								<p>Optional · up to four ordered calculations.</p>
							</div>
							<button
								type="button"
								className="ghost"
								onClick={addMeasure}
								disabled={
									!canConfigureMeasures ||
									measureFields.length === 0 ||
									measures.length >= 4
								}
							>
								Add measure
							</button>
						</div>
						{!canConfigureMeasures ? (
							<p className="object-grouping-footnote">
								Numeric measures require a server-supported group field.
							</p>
						) : measureFields.length === 0 ? (
							<p className="object-grouping-footnote">
								No numeric data or computed fields are available yet.
							</p>
						) : null}
						{measures.map((measure, index) => (
							<div
								className="object-aggregate-measure-row"
								key={measure.id}
							>
								<label className="control-field">
									<span>Calculation {index + 1}</span>
									<select
										value={measure.operation}
										onChange={(event) =>
											updateMeasure(index, {
												operation: event.target
													.value as ObjectAggregateMeasureOperation,
											})
										}
									>
										{MEASURE_OPERATIONS.map((operation) => (
											<option key={operation.value} value={operation.value}>
												{operation.label}
											</option>
										))}
									</select>
								</label>
								<label className="control-field">
									<span>Numeric field</span>
									<select
										value={measure.field}
										onChange={(event) =>
											updateMeasure(index, { field: event.target.value })
										}
									>
										{FIELD_SECTIONS.filter(
											(section) =>
												section === "Data fields" ||
												section === "Computed fields",
										).map((section) => {
											const sectionFields = measureFields.filter(
												(field) => field.section === section,
											);
											return sectionFields.length > 0 ? (
												<optgroup key={section} label={section}>
													{sectionFields.map((field) => (
														<option key={field.id} value={field.field}>
															{field.label}
														</option>
													))}
												</optgroup>
											) : null;
										})}
									</select>
								</label>
								<button
									type="button"
									className="ghost danger"
									onClick={() =>
										onMeasuresChange(
											measures.filter(
												(_, measureIndex) => measureIndex !== index,
											),
										)
									}
									aria-label={`Remove calculation ${index + 1}`}
								>
									Remove
								</button>
							</div>
						))}
					</div>
					<label className="control-field">
						<span>Sort groups</span>
						<select
							value={sort}
							disabled={!selectedField}
							onChange={(event) =>
								onSortChange(event.target.value as ObjectGroupSort)
							}
						>
							{SORT_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<p className="object-grouping-footnote">
						{usesServerAggregation
							? "Server filters are applied before aggregation."
							: "Use a server-supported field or report to group beyond this page."}
					</p>
				</div>
			) : null}
		</div>
	);
}
