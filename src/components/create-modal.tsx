"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";

import { useDialogAccessibility } from "@/lib/use-dialog-accessibility";

type CreateModalProps = {
	open: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
	navigation?: ModalRecordNavigation;
};

export type ModalRecordNavigation = {
	current: number;
	total: number;
	itemLabel: string;
	onPrevious?: () => void;
	onNext?: () => void;
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

function IconArrow({ direction }: { direction: "left" | "right" }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d={
					direction === "left"
						? "m14.7 5.3-1.4-1.4L5.2 12l8.1 8.1 1.4-1.4L8 12z"
						: "m9.3 18.7 1.4 1.4 8.1-8.1-8.1-8.1-1.4 1.4L16 12z"
				}
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
	navigation,
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

	useEffect(() => {
		if (!open || !navigation) {
			return;
		}
		const activeNavigation = navigation;

		function onKeyDown(event: KeyboardEvent) {
			if (
				event.defaultPrevented ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey
			) {
				return;
			}

			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.matches("input, textarea, select") || target.isContentEditable)
			) {
				return;
			}

			if (event.key === "ArrowLeft" && activeNavigation.onPrevious) {
				event.preventDefault();
				activeNavigation.onPrevious();
			} else if (event.key === "ArrowRight" && activeNavigation.onNext) {
				event.preventDefault();
				activeNavigation.onNext();
			}
		}

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [navigation, open]);

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
				className={`modal-panel card${navigation ? " modal-panel--navigable" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				{navigation ? (
					<>
						<button
							type="button"
							className="modal-record-navigation modal-record-navigation--previous"
							onClick={navigation.onPrevious}
							disabled={!navigation.onPrevious}
							aria-label={`Previous ${navigation.itemLabel}`}
							aria-keyshortcuts="ArrowLeft"
						>
							<IconArrow direction="left" />
						</button>
						<button
							type="button"
							className="modal-record-navigation modal-record-navigation--next"
							onClick={navigation.onNext}
							disabled={!navigation.onNext}
							aria-label={`Next ${navigation.itemLabel}`}
							aria-keyshortcuts="ArrowRight"
						>
							<IconArrow direction="right" />
						</button>
					</>
				) : null}
				<header className="modal-header">
					<div className="modal-heading">
						<h3 id={titleId}>{title}</h3>
						{navigation ? (
							<span className="muted modal-record-position" aria-live="polite">
								{navigation.current} of {navigation.total} on this page
							</span>
						) : null}
					</div>
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
