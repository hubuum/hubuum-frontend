"use client";

import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

export type DirectoryLookupOption<T> = {
	id: string;
	item: T;
	primary: string;
	secondary: string;
	title: string;
};

type DirectoryLookupPopoverProps<T> = {
	disabled?: boolean;
	disabledHint?: string;
	helperText: ReactNode;
	idPrefix: string;
	inputLabel: string;
	label: string;
	onChange: (value: string) => void;
	onSelect: (item: T) => void;
	options: readonly DirectoryLookupOption<T>[];
	placeholder: string;
	value: string;
};

function IconSearch() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.44 1.42-1.42-4.44-4.43A6.5 6.5 0 0 0 10.5 4m0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9"
				fill="currentColor"
			/>
		</svg>
	);
}

export function DirectoryLookupPopover<T>({
	disabled = false,
	disabledHint,
	helperText,
	idPrefix,
	inputLabel,
	label,
	onChange,
	onSelect,
	options,
	placeholder,
	value,
}: DirectoryLookupPopoverProps<T>) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [open, setOpen] = useState(false);
	const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
	const activeOption = options[activeOptionIndex];
	const listboxOpen = open && options.length > 0;
	const inputId = `${idPrefix}-search`;
	const listboxId = `${idPrefix}-options`;
	const helperId = `${idPrefix}-lookup-hint`;
	const popoverId = `${idPrefix}-popover`;

	function optionId(option: DirectoryLookupOption<T>): string {
		return `${idPrefix}-option-${option.id}`;
	}

	function close(restoreFocus = false) {
		setOpen(false);
		setActiveOptionIndex(-1);
		if (restoreFocus) {
			window.setTimeout(() => triggerRef.current?.focus(), 0);
		}
	}

	function select(option: DirectoryLookupOption<T>) {
		onSelect(option.item);
		close(true);
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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

		if (event.key === "Enter") {
			event.preventDefault();
			if (listboxOpen && activeOption) select(activeOption);
		}
	}

	useEscapeToCancel({
		enabled: open,
		onCancel: () => close(true),
	});

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) {
				setOpen(false);
				setActiveOptionIndex(-1);
			}
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		window.setTimeout(() => inputRef.current?.focus(), 0);
	}, [open]);

	useEffect(() => {
		if (disabled && open) {
			setOpen(false);
			setActiveOptionIndex(-1);
		}
	}, [disabled, open]);

	useEffect(() => {
		if (!listboxOpen || !activeOption) return;
		document
			.getElementById(`${idPrefix}-option-${activeOption.id}`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeOption, idPrefix, listboxOpen]);

	return (
		<div className="directory-lookup" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="ghost directory-lookup-trigger"
				disabled={disabled}
				aria-label={label}
				aria-expanded={open}
				aria-controls={open ? popoverId : undefined}
				title={disabled ? disabledHint : label}
				onClick={() => {
					if (open) {
						close();
					} else {
						setOpen(true);
					}
				}}
			>
				<IconSearch />
				<span>Find</span>
			</button>
			{open ? (
				<div id={popoverId} className="card directory-lookup-popover">
					<div className="directory-lookup-popover-header">
						<strong>{label}</strong>
						<button type="button" className="ghost" onClick={() => close(true)}>
							Close
						</button>
					</div>
					<label htmlFor={inputId}>{inputLabel}</label>
					<div className="directory-lookup-combobox">
						<input
							ref={inputRef}
							id={inputId}
							type="search"
							role="combobox"
							value={value}
							onChange={(event) => {
								setOpen(true);
								setActiveOptionIndex(-1);
								onChange(event.target.value);
							}}
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
								className="directory-lookup-options"
								role="listbox"
								aria-label={`${label} search results`}
							>
								{options.map((option, index) => (
									<button
										key={option.id}
										id={optionId(option)}
										type="button"
										role="option"
										className="directory-lookup-option"
										aria-selected={index === activeOptionIndex}
										tabIndex={-1}
										title={option.title}
										onMouseEnter={() => setActiveOptionIndex(index)}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => select(option)}
									>
										<span className="directory-lookup-option-name">
											{option.primary}
										</span>
										<span className="directory-lookup-option-detail">
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
			) : null}
		</div>
	);
}
