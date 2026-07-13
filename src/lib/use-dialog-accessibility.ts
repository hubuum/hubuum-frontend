"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled]):not([type='hidden'])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]:not([tabindex='-1'])",
].join(",");

let openDialogCount = 0;
const dialogStack: symbol[] = [];

type DialogAccessibilityOptions = {
	open: boolean;
	onClose: () => void;
	dialogRef: RefObject<HTMLElement | null>;
	overlayRef: RefObject<HTMLElement | null>;
	initialFocusSelector?: string;
};

function setOutsideContentInert(overlay: HTMLElement): Array<{
	element: HTMLElement;
	wasInert: boolean;
}> {
	const changed: Array<{ element: HTMLElement; wasInert: boolean }> = [];
	let current: HTMLElement = overlay;

	while (current.parentElement) {
		const parent = current.parentElement;
		for (const sibling of Array.from(parent.children)) {
			if (!(sibling instanceof HTMLElement) || sibling === current) continue;
			changed.push({ element: sibling, wasInert: sibling.inert });
			sibling.inert = true;
		}
		if (parent === document.body) break;
		current = parent;
	}

	return changed;
}

export function useDialogAccessibility({
	open,
	onClose,
	dialogRef,
	overlayRef,
	initialFocusSelector,
}: DialogAccessibilityOptions): void {
	const previousFocusRef = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(onClose);
	const dialogIdRef = useRef(Symbol("dialog"));

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		if (!open) return;

		previousFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		openDialogCount += 1;
		dialogStack.push(dialogIdRef.current);
		document.body.classList.add("modal-open");

		const overlay = overlayRef.current;
		const inertElements = overlay ? setOutsideContentInert(overlay) : [];
		const frame = window.requestAnimationFrame(() => {
			const dialog = dialogRef.current;
			if (!dialog) return;
			const initialFocus = initialFocusSelector
				? dialog.querySelector<HTMLElement>(initialFocusSelector)
				: null;
			const firstFocusable =
				dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
			(initialFocus ?? firstFocusable ?? dialog).focus();
		});

		const onKeyDown = (event: KeyboardEvent) => {
			if (dialogStack.at(-1) !== dialogIdRef.current) return;

			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onCloseRef.current();
				return;
			}

			if (event.key !== "Tab") return;
			const dialog = dialogRef.current;
			if (!dialog) return;
			const focusable = Array.from(
				dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			).filter(
				(element) =>
					element.offsetParent !== null &&
					!element.hasAttribute("disabled") &&
					!element.inert,
			);

			if (focusable.length === 0) {
				event.preventDefault();
				dialog.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.cancelAnimationFrame(frame);
			document.removeEventListener("keydown", onKeyDown, true);
			for (const { element, wasInert } of inertElements) {
				element.inert = wasInert;
			}
			const stackIndex = dialogStack.lastIndexOf(dialogIdRef.current);
			if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
			openDialogCount = Math.max(0, openDialogCount - 1);
			if (openDialogCount === 0) document.body.classList.remove("modal-open");
			const previousFocus = previousFocusRef.current;
			window.requestAnimationFrame(() => {
				if (previousFocus?.isConnected) previousFocus.focus();
			});
		};
	}, [dialogRef, initialFocusSelector, open, overlayRef]);
}
