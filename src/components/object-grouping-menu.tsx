"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type ObjectGroupingMenuProps = {
	fields: readonly ObjectGroupingField[];
	fieldId: string | null;
	sort: ObjectGroupSort;
	onFieldChange: (fieldId: string | null) => void;
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
	sort,
	onFieldChange,
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
	const usesServerAggregation = Boolean(selectedField?.serverGroupBy);

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
				<span>Group</span>
				{selectedField ? (
					<span className="object-grouping-active">
						<span className="sr-only">Grouping active: </span>1
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
							<strong>
								{usesServerAggregation
									? "Group all matching objects"
									: "Group objects"}
							</strong>
							<p>
								{usesServerAggregation
									? "Counts are permission-aware and calculated by the server."
									: selectedField
										? "Custom fallback fields are calculated from the current fetched page."
										: "Supported fields use server aggregation across the full filtered class."}
							</p>
						</div>
						{selectedField ? (
							<button
								type="button"
								className="ghost"
								onClick={() => onFieldChange(null)}
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
