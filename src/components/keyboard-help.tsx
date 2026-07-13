"use client";

import { useId, useRef } from "react";

import { useDialogAccessibility } from "@/lib/use-dialog-accessibility";

type KeyboardHelpProps = {
	open: boolean;
	onClose: () => void;
};

type Shortcut = {
	keys: string[];
	description: string;
};

const shortcuts: Shortcut[] = [
	{ keys: ["C"], description: "Create new item (on applicable pages)" },
	{ keys: ["E"], description: "Edit current item (on applicable pages)" },
	{ keys: ["Shift", "Enter"], description: "Save or create from a form" },
	{ keys: ["D"], description: "Delete selected items" },
	{ keys: ["Esc"], description: "Deselect all items" },
	{ keys: ["Ctrl", "A"], description: "Select all visible items" },
	{ keys: ["/"], description: "Focus global search" },
	{ keys: ["?"], description: "Show this help" },
	{ keys: ["↑", "↓"], description: "Navigate table rows" },
	{ keys: ["Enter"], description: "Open focused row" },
	{ keys: ["N"], description: "Go to the next page in the active paged view" },
	{
		keys: ["P"],
		description: "Go to the previous page in the active paged view",
	},
	{ keys: ["G", "H"], description: "Go to Home" },
	{ keys: ["G", "N"], description: "Go to Collections" },
	{ keys: ["G", "C"], description: "Go to Classes" },
	{ keys: ["G", "O"], description: "Go to Objects" },
	{ keys: ["G", "R"], description: "Go to Relations" },
	{ keys: ["G", "E"], description: "Go to Exports" },
	{ keys: ["G", "I"], description: "Go to Imports" },
	{ keys: ["G", "T"], description: "Go to Tasks" },
	{ keys: ["G", "S"], description: "Go to Statistics" },
	{ keys: ["G", "U"], description: "Go to Users" },
	{ keys: ["G", "M"], description: "Go to Groups" },
];

export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
	const titleId = useId();
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const dialogRef = useRef<HTMLDivElement | null>(null);
	useDialogAccessibility({
		open,
		onClose,
		dialogRef,
		overlayRef,
	});

	if (!open) {
		return null;
	}

	return (
		<div
			className="keyboard-help-backdrop"
			ref={overlayRef}
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				className="keyboard-help card"
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				<div className="keyboard-help-header">
					<h2 id={titleId}>Keyboard Shortcuts</h2>
					<button
						type="button"
						className="ghost icon-button"
						onClick={onClose}
						aria-label="Close help"
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"
								fill="currentColor"
							/>
						</svg>
					</button>
				</div>
				<div className="keyboard-help-content">
					{shortcuts.map((shortcut) => (
						<div key={shortcut.description} className="keyboard-shortcut-row">
							<div className="keyboard-shortcut-keys">
								{shortcut.keys.map((key, keyIndex) => (
									<span key={`${shortcut.description}-${key}`}>
										<kbd className="keyboard-key">{key}</kbd>
										{keyIndex < shortcut.keys.length - 1 ? (
											<span className="keyboard-plus">+</span>
										) : null}
									</span>
								))}
							</div>
							<div className="keyboard-shortcut-description">
								{shortcut.description}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
