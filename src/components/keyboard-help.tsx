"use client";

import { useEffect } from "react";

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
	{ keys: ["D"], description: "Delete selected items" },
	{ keys: ["Esc"], description: "Deselect all items" },
	{ keys: ["Ctrl", "A"], description: "Select all visible items" },
	{ keys: ["/"], description: "Focus global search" },
	{ keys: ["?"], description: "Show this help" },
	{ keys: ["↑", "↓"], description: "Navigate table rows" },
	{ keys: ["Enter"], description: "Open focused row" },
	{ keys: ["N"], description: "Go to the next page in the active paged view" },
	{ keys: ["P"], description: "Go to the previous page in the active paged view" },
];

export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
	useEffect(() => {
		if (!open) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	useEffect(() => {
		if (!open) {
			return;
		}

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains("keyboard-help-backdrop")) {
				onClose();
			}
		};

		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, onClose]);

	if (!open) {
		return null;
	}

	return (
		<div className="keyboard-help-backdrop">
			<div className="keyboard-help card">
				<div className="keyboard-help-header">
					<h2>Keyboard Shortcuts</h2>
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
