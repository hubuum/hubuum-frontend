"use client";

import { useEffect, useRef } from "react";

type EscapeCancelRegistration = {
	ignoreSelector?: string;
	onCancelRef: { current: () => void };
};

type UseEscapeToCancelOptions = {
	enabled: boolean;
	onCancel: () => void;
	ignoreSelector?: string;
};

export type EscapeCancelKeyState = {
	defaultPrevented: boolean;
	isComposing: boolean;
	key: string;
	repeat: boolean;
};

export class EscapeCancelStack<T> {
	readonly #entries: T[] = [];

	get current(): T | undefined {
		return this.#entries.at(-1);
	}

	get hasActiveEntry(): boolean {
		return this.#entries.length > 0;
	}

	add(entry: T): () => void {
		this.#entries.push(entry);
		let active = true;
		return () => {
			if (!active) {
				return;
			}
			active = false;
			const index = this.#entries.lastIndexOf(entry);
			if (index >= 0) {
				this.#entries.splice(index, 1);
			}
		};
	}
}

const escapeCancelStack = new EscapeCancelStack<EscapeCancelRegistration>();

export function hasActiveEscapeCancel(): boolean {
	return escapeCancelStack.hasActiveEntry;
}

export function shouldCancelWithEscape({
	defaultPrevented,
	isComposing,
	key,
	repeat,
}: EscapeCancelKeyState): boolean {
	return key === "Escape" && !defaultPrevented && !isComposing && !repeat;
}

function onDocumentKeyDown(event: KeyboardEvent) {
	const current = escapeCancelStack.current;
	if (
		!current ||
		!shouldCancelWithEscape(event) ||
		(current.ignoreSelector &&
			event.target instanceof Element &&
			event.target.closest(current.ignoreSelector))
	) {
		return;
	}

	event.preventDefault();
	event.stopImmediatePropagation();
	current.onCancelRef.current();
}

function registerEscapeCancel(registration: EscapeCancelRegistration) {
	if (!escapeCancelStack.hasActiveEntry) {
		document.addEventListener("keydown", onDocumentKeyDown);
	}
	const removeRegistration = escapeCancelStack.add(registration);

	return () => {
		removeRegistration();
		if (!escapeCancelStack.hasActiveEntry) {
			document.removeEventListener("keydown", onDocumentKeyDown);
		}
	};
}

/**
 * Cancels only the most recently activated non-modal interaction on Escape.
 * Modal dialogs keep their own focus-trapped Escape handling and take priority.
 */
export function useEscapeToCancel({
	enabled,
	onCancel,
	ignoreSelector,
}: UseEscapeToCancelOptions): void {
	const onCancelRef = useRef(onCancel);

	useEffect(() => {
		onCancelRef.current = onCancel;
	}, [onCancel]);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		return registerEscapeCancel({
			ignoreSelector,
			onCancelRef,
		});
	}, [enabled, ignoreSelector]);
}
