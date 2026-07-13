"use client";

import type { ReactNode } from "react";
import { useId, useRef } from "react";

import { useDialogAccessibility } from "@/lib/use-dialog-accessibility";

type CreateModalProps = {
	open: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
};

function IconClose() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="m19 6.41-1.41-1.4L12 10.58 6.41 5 5 6.41 10.58 12 5 17.58 6.41 19 12 13.41 17.59 19 19 17.58 13.41 12z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function CreateModal({
	open,
	title,
	onClose,
	children,
}: CreateModalProps) {
	const titleId = useId();
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const panelRef = useRef<HTMLElement | null>(null);
	useDialogAccessibility({
		open,
		onClose,
		dialogRef: panelRef,
		overlayRef,
		initialFocusSelector:
			".modal-content input:not([type='hidden']):not([disabled]), .modal-content select:not([disabled]), .modal-content textarea:not([disabled]), .modal-content button:not([disabled])",
	});

	if (!open) {
		return null;
	}

	return (
		<div className="modal-overlay" ref={overlayRef}>
			<button
				type="button"
				className="modal-backdrop"
				onClick={onClose}
				aria-label="Close dialog"
			/>
			<section
				ref={panelRef}
				className="modal-panel card"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				<header className="modal-header">
					<h3 id={titleId}>{title}</h3>
					<button
						type="button"
						className="ghost icon-button"
						onClick={onClose}
						aria-label="Close dialog"
					>
						<IconClose />
					</button>
				</header>
				<div className="modal-content">{children}</div>
			</section>
		</div>
	);
}
