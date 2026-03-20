"use client";

import { indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { Compartment, type Extension, StateEffect } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef } from "react";

type CodeEditorProps = {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	rows?: number;
	extensions?: Extension[];
	className?: string;
	inputId?: string;
	ariaLabel?: string;
};

const syncExternalValue = StateEffect.define<{
	from: number;
	to: number;
	insert: string;
}>();

const sharedEditorTheme = EditorView.theme({
	"&": {
		background:
			"linear-gradient(180deg, color-mix(in srgb, var(--bg-highlight) 88%, var(--card)), var(--bg-highlight))",
		color: "var(--ink)",
		fontFamily: '"IBM Plex Mono", "SFMono-Regular", "Menlo", monospace',
		fontSize: "0.88rem",
		lineHeight: "1.5",
	},
	"&.cm-focused": {
		outline: "none",
	},
	".cm-scroller": {
		minHeight: "var(--code-editor-min-height, 12rem)",
		padding: "1rem",
		fontFamily: "inherit",
	},
	".cm-content, .cm-gutter": {
		fontFamily: "inherit",
		fontSize: "inherit",
		lineHeight: "inherit",
	},
	".cm-content": {
		caretColor: "var(--accent)",
	},
	".cm-line": {
		padding: 0,
	},
	".cm-placeholder": {
		color: "var(--muted)",
	},
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
		backgroundColor: "color-mix(in srgb, var(--accent) 24%, transparent)",
	},
	".cm-cursor, .cm-dropCursor": {
		borderLeftColor: "var(--accent)",
	},
	".cm-panels": {
		background: "var(--card)",
		color: "var(--ink)",
	},
});

export function CodeEditor({
	value,
	onChange,
	placeholder,
	disabled = false,
	rows = 8,
	extensions = [],
	className,
	inputId,
	ariaLabel,
}: CodeEditorProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	const initialValueRef = useRef(value);
	const initialDisabledRef = useRef(disabled);
	const initialPlaceholderRef = useRef(placeholder);
	const initialExtensionsRef = useRef(extensions);
	const initialInputIdRef = useRef(inputId);
	const initialAriaLabelRef = useRef(ariaLabel);
	const editableCompartmentRef = useRef(new Compartment());
	const placeholderCompartmentRef = useRef(new Compartment());
	const extensionsCompartmentRef = useRef(new Compartment());
	const attributesCompartmentRef = useRef(new Compartment());

	onChangeRef.current = onChange;

	const hostStyle = useMemo(
		() =>
			({
				"--code-editor-min-height": `calc(${rows} * 1.5em + 2rem)`,
			}) as CSSProperties,
		[rows],
	);

	useEffect(() => {
		if (!hostRef.current) {
			return;
		}

		const editableCompartment = editableCompartmentRef.current;
		const placeholderCompartment = placeholderCompartmentRef.current;
		const extensionsCompartment = extensionsCompartmentRef.current;
		const attributesCompartment = attributesCompartmentRef.current;

		const view = new EditorView({
			parent: hostRef.current,
			doc: initialValueRef.current,
			extensions: [
				minimalSetup,
				EditorView.lineWrapping,
				bracketMatching(),
				keymap.of([indentWithTab]),
				sharedEditorTheme,
				editableCompartment.of(
					EditorView.editable.of(!initialDisabledRef.current),
				),
				placeholderCompartment.of(
					initialPlaceholderRef.current
						? placeholderExtension(initialPlaceholderRef.current)
						: [],
				),
				extensionsCompartment.of(initialExtensionsRef.current),
				attributesCompartment.of(
					EditorView.contentAttributes.of({
						...(initialInputIdRef.current
							? { id: initialInputIdRef.current }
							: {}),
						...(initialAriaLabelRef.current
							? { "aria-label": initialAriaLabelRef.current }
							: {}),
					}),
				),
				EditorView.updateListener.of((update) => {
					if (!update.docChanged) {
						return;
					}

					if (update.transactions.some((transaction) =>
						transaction.effects.some((effect) => effect.is(syncExternalValue)),
					)) {
						return;
					}

					onChangeRef.current(update.state.doc.toString());
				}),
			],
		});

		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		view.dispatch({
			effects: editableCompartmentRef.current.reconfigure(
				EditorView.editable.of(!disabled),
			),
		});
	}, [disabled]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		view.dispatch({
			effects: placeholderCompartmentRef.current.reconfigure(
				placeholder ? placeholderExtension(placeholder) : [],
			),
		});
	}, [placeholder]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		view.dispatch({
			effects: extensionsCompartmentRef.current.reconfigure(extensions),
		});
	}, [extensions]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		view.dispatch({
			effects: attributesCompartmentRef.current.reconfigure(
				EditorView.contentAttributes.of({
					...(inputId ? { id: inputId } : {}),
					...(ariaLabel ? { "aria-label": ariaLabel } : {}),
				}),
			),
		});
	}, [inputId, ariaLabel]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) {
			return;
		}

		const currentValue = view.state.doc.toString();
		if (currentValue === value) {
			return;
		}

		view.dispatch({
			changes: {
				from: 0,
				to: currentValue.length,
				insert: value,
			},
			effects: syncExternalValue.of({
				from: 0,
				to: currentValue.length,
				insert: value,
			}),
		});
	}, [value]);

	return (
		<div
			ref={hostRef}
			className={`code-editor-host${className ? ` ${className}` : ""}`}
			data-disabled={disabled ? "true" : "false"}
			style={hostStyle}
		/>
	);
}
