"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

export type AuditSearchOption<T> = {
	id: string;
	item: T;
	primary: string;
	secondary: string;
	title: string;
};

type AuditSearchLookupProps<T> = {
	helperText: ReactNode;
	idPrefix: string;
	label: string;
	onChange: (value: string) => void;
	onSelect: (item: T) => void;
	options: readonly AuditSearchOption<T>[];
	placeholder: string;
	value: string;
};

export function AuditSearchLookup<T>({
	helperText,
	idPrefix,
	label,
	onChange,
	onSelect,
	options,
	placeholder,
	value,
}: AuditSearchLookupProps<T>) {
	const [open, setOpen] = useState(false);
	const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
	const activeOption = options[activeOptionIndex];
	const listboxOpen = open && options.length > 0;
	const inputId = `${idPrefix}-search`;
	const listboxId = `${idPrefix}-options`;
	const helperId = `${idPrefix}-lookup-hint`;

	function optionId(option: AuditSearchOption<T>): string {
		return `${idPrefix}-option-${option.id}`;
	}

	function close() {
		setOpen(false);
		setActiveOptionIndex(-1);
	}

	function select(option: AuditSearchOption<T>) {
		onSelect(option.item);
		close();
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Escape" && open) {
			event.preventDefault();
			close();
			return;
		}

		if (!options.length) return;

		if (event.key === "ArrowDown") {
			event.preventDefault();
			setOpen(true);
			setActiveOptionIndex((current) =>
				current >= options.length - 1 ? 0 : current + 1,
			);
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
			setActiveOptionIndex((current) =>
				current <= 0 ? options.length - 1 : current - 1,
			);
			return;
		}

		if (event.key === "Enter" && listboxOpen && activeOption) {
			event.preventDefault();
			select(activeOption);
		}
	}

	useEffect(() => {
		if (!value) {
			setOpen(false);
			setActiveOptionIndex(-1);
		}
	}, [value]);

	useEffect(() => {
		if (!listboxOpen || !activeOption) return;
		document
			.getElementById(`${idPrefix}-option-${activeOption.id}`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeOption, idPrefix, listboxOpen]);

	return (
		<div className="control-field audit-search-lookup">
			<label htmlFor={inputId}>{label}</label>
			<div className="audit-search-combobox">
				<input
					id={inputId}
					type="search"
					role="combobox"
					value={value}
					onChange={(event) => {
						setOpen(true);
						setActiveOptionIndex(-1);
						onChange(event.target.value);
					}}
					onFocus={() => setOpen(true)}
					onBlur={close}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					autoComplete="off"
					aria-autocomplete="list"
					aria-controls={listboxOpen ? listboxId : undefined}
					aria-describedby={helperId}
					aria-expanded={listboxOpen}
					aria-activedescendant={
						listboxOpen && activeOption ? optionId(activeOption) : undefined
					}
				/>
				{listboxOpen ? (
					<div
						id={listboxId}
						className="audit-search-options"
						role="listbox"
						aria-label={`${label} search results`}
					>
						{options.map((option, index) => (
							<button
								key={option.id}
								id={optionId(option)}
								type="button"
								role="option"
								className="audit-search-option"
								aria-selected={index === activeOptionIndex}
								tabIndex={-1}
								title={option.title}
								onMouseEnter={() => setActiveOptionIndex(index)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => select(option)}
							>
								<span className="audit-search-option-name">
									{option.primary}
								</span>
								<span className="audit-search-option-detail">
									{option.secondary}
								</span>
							</button>
						))}
					</div>
				) : null}
			</div>
			<small id={helperId} className="muted" aria-live="polite">
				{helperText}
			</small>
		</div>
	);
}
