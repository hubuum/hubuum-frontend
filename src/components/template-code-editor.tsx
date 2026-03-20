"use client";

import {
	acceptCompletion,
	autocompletion,
	closeCompletion,
	completionStatus,
	startCompletion,
	type Completion,
	type CompletionContext,
} from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { linter, type Diagnostic } from "@codemirror/lint";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
	keymap,
} from "@codemirror/view";
import { useMemo } from "react";

import { CodeEditor } from "@/components/code-editor";
import type { ReportScopeKind } from "@/lib/api/reporting";
import {
	analyzeTemplate,
	getTemplateSuggestions,
	validateTemplateExpression,
} from "@/lib/template-suggestions";

type TemplateCodeEditorProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	scopeKind?: ReportScopeKind;
};

type MustacheContext = {
	openStart: number;
	closeStart: number | null;
	contentStart: number;
	contentEnd: number;
	queryFrom: number;
	queryTo: number;
	leadingWhitespace: string;
	trailingWhitespace: string;
	insideLoop: boolean;
};

const templateDelimiterMark = Decoration.mark({
	class: "cm-template-delimiter",
});
const templateKeywordMark = Decoration.mark({
	class: "cm-template-keyword",
});
const templatePathMark = Decoration.mark({
	class: "cm-template-path",
});
const templateQueryTokenPattern = /[#/A-Za-z0-9_.]/;

function isInsideEachBlock(text: string, cursorPos: number): boolean {
	const beforeCursor = text.slice(0, cursorPos);
	const openCount = (beforeCursor.match(/\{\{#each\s+/g) ?? []).length;
	const closeCount = (beforeCursor.match(/\{\{\/each\}\}/g) ?? []).length;
	return openCount > closeCount;
}

function getMustacheContext(text: string, cursorPos: number): MustacheContext | null {
	let openStart = -1;

	for (let index = cursorPos; index >= 1; index -= 1) {
		if (text[index - 1] === "}" && text[index] === "}") {
			return null;
		}
		if (text[index - 1] === "{" && text[index] === "{") {
			openStart = index - 1;
			break;
		}
	}

	if (openStart < 0) {
		return null;
	}

	let closeStart: number | null = null;
	for (let index = cursorPos; index < text.length - 1; index += 1) {
		if (text[index] === "}" && text[index + 1] === "}") {
			closeStart = index;
			break;
		}
		if (text[index] === "{" && text[index + 1] === "{") {
			break;
		}
	}

	const contentStart = openStart + 2;
	const contentEnd = closeStart ?? cursorPos;
	if (contentEnd < contentStart) {
		return null;
	}

	const currentContent = text.slice(contentStart, contentEnd);
	const leadingWhitespace = currentContent.match(/^\s*/)?.[0] ?? "";
	const trailingWhitespace = currentContent.match(/\s*$/)?.[0] ?? "";
	const queryFloor = contentStart + leadingWhitespace.length;

	let queryFrom = cursorPos;
	while (
		queryFrom > queryFloor &&
		templateQueryTokenPattern.test(text[queryFrom - 1] ?? "")
	) {
		queryFrom -= 1;
	}

	let queryTo = cursorPos;
	while (
		queryTo < contentEnd &&
		templateQueryTokenPattern.test(text[queryTo] ?? "")
	) {
		queryTo += 1;
	}

	return {
		openStart,
		closeStart,
		contentStart,
		contentEnd,
		queryFrom,
		queryTo,
		leadingWhitespace,
		trailingWhitespace,
		insideLoop: isInsideEachBlock(text, openStart),
	};
}

function applyTemplateCompletion(
	view: EditorView,
	context: MustacheContext,
	completion: Completion,
) {
	const replacementContent = `${context.leadingWhitespace}${completion.label}${
		context.closeStart !== null ? context.trailingWhitespace : ""
	}`;
	const replacement = `{{${replacementContent}}}`;
	const replaceTo =
		context.closeStart !== null ? context.closeStart + 2 : context.contentEnd;

	view.dispatch({
		changes: {
			from: context.openStart,
			to: replaceTo,
			insert: replacement,
		},
		selection: {
			anchor: context.openStart + replacement.length,
		},
	});
	view.focus();
}

function buildTemplateDecorations(text: string): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const fullExpressionPattern = /\{\{(#each\s+[^}]+|\/each|[^}]+)\}\}/g;

	for (const match of text.matchAll(fullExpressionPattern)) {
		const matchedValue = match[0];
		const expressionBody = match[1] ?? "";
		const matchStart = match.index ?? 0;
		const matchEnd = matchStart + matchedValue.length;
		const bodyStart = matchStart + 2;
		const bodyEnd = matchEnd - 2;
		const leadingWhitespaceLength = expressionBody.match(/^\s*/)?.[0].length ?? 0;
		const trimmedBodyStart = bodyStart + leadingWhitespaceLength;
		const trimmedBody = expressionBody.trim();

		builder.add(matchStart, matchStart + 2, templateDelimiterMark);

		if (trimmedBody.startsWith("#each")) {
			builder.add(trimmedBodyStart, trimmedBodyStart + 5, templateKeywordMark);
			const pathStart = trimmedBodyStart + 5;
			for (const pathMatch of trimmedBody.slice(5).matchAll(/[A-Za-z_][\w.]*/g)) {
				const start = pathStart + (pathMatch.index ?? 0);
				builder.add(start, start + pathMatch[0].length, templatePathMark);
			}
			continue;
		}

		if (trimmedBody.startsWith("/each")) {
			builder.add(trimmedBodyStart, trimmedBodyStart + 5, templateKeywordMark);
			continue;
		}

		for (const pathMatch of expressionBody.matchAll(/[A-Za-z_][\w.]*/g)) {
			const start = bodyStart + (pathMatch.index ?? 0);
			if (start >= bodyEnd) {
				continue;
			}
			builder.add(start, start + pathMatch[0].length, templatePathMark);
		}

		builder.add(matchEnd - 2, matchEnd, templateDelimiterMark);
	}

	return builder.finish();
}

const templateHighlightExtension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildTemplateDecorations(view.state.doc.toString());
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = buildTemplateDecorations(
					update.state.doc.toString(),
				);
			}
		}
	},
	{
		decorations: (value) => value.decorations,
	},
);

function createTemplateCompletionSource(scopeKind?: ReportScopeKind) {
	return (context: CompletionContext) => {
		const documentText = context.state.doc.toString();
		const mustacheContext = getMustacheContext(documentText, context.pos);

		if (!mustacheContext) {
			return null;
		}

		const options = getTemplateSuggestions(
			scopeKind,
			mustacheContext.insideLoop,
		).map((option) => ({
			...option,
			apply: (view: EditorView, completion: Completion) =>
				applyTemplateCompletion(view, mustacheContext, completion),
		}));

		return {
			from: mustacheContext.queryFrom,
			to: mustacheContext.queryTo,
			options,
			validFor: /^[#/.\w]*$/,
		};
	};
}

function createCompletionTriggerExtension() {
	return EditorView.updateListener.of((update) => {
		if (!update.view.hasFocus || !update.state.selection.main.empty) {
			return;
		}

		if (!update.docChanged && !update.selectionSet) {
			return;
		}

		const currentContext = getMustacheContext(
			update.state.doc.toString(),
			update.state.selection.main.head,
		);
		const status = completionStatus(update.state);

		if (!currentContext) {
			if (status === "active" || status === "pending") {
				queueMicrotask(() => {
					if (update.view.state === update.state) {
						closeCompletion(update.view);
					}
				});
			}
			return;
		}

		queueMicrotask(() => {
			if (update.view.state === update.state) {
				startCompletion(update.view);
			}
		});
	});
}

function getTemplateDiagnostics(
	text: string,
	scopeKind: ReportScopeKind | undefined,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const fullExpressionPattern = /\{\{([^}]+)\}\}/g;

	for (const match of text.matchAll(fullExpressionPattern)) {
		const expressionBody = match[1] ?? "";
		const expressionStart = (match.index ?? 0) + 2;
		const insideLoop = isInsideEachBlock(text, expressionStart);
		const validation = validateTemplateExpression(
			expressionBody,
			scopeKind,
			insideLoop,
		);
		if (!validation) {
			continue;
		}

		const rawIndex = expressionBody.indexOf(validation.path);
		if (rawIndex < 0) {
			continue;
		}

		const from = expressionStart + rawIndex;
		const to = from + validation.path.length;
		diagnostics.push({
			from,
			to,
			severity: "error",
			source: "Template scope",
			message: validation.message,
		});
	}

	return diagnostics;
}

export function TemplateCodeEditor({
	label,
	value,
	onChange,
	placeholder,
	disabled,
	scopeKind,
}: TemplateCodeEditorProps) {
	const analysis = useMemo(() => analyzeTemplate(value), [value]);

	const extensions = useMemo<Extension[]>(
		() => [
			templateHighlightExtension,
			createCompletionTriggerExtension(),
			linter(
				(view) => getTemplateDiagnostics(view.state.doc.toString(), scopeKind),
				{
					delay: 0,
					autoPanel: false,
				},
			),
			keymap.of([
				{
					key: "Tab",
					run: (view) =>
						acceptCompletion(view) || Boolean(indentWithTab.run?.(view)),
				},
			]),
			autocompletion({
				override: [createTemplateCompletionSource(scopeKind)],
				activateOnTyping: true,
				closeOnBlur: true,
				selectOnOpen: true,
				maxRenderedOptions: 14,
				tooltipClass: () => "template-completion-tooltip",
				optionClass: () => "template-completion-option",
			}),
		],
		[scopeKind],
	);

	const balanceMessage =
		analysis.openEach === analysis.closeEach
			? "Loop blocks balanced"
			: analysis.openEach > analysis.closeEach
				? `${analysis.openEach - analysis.closeEach} unclosed {{#each}} block(s)`
				: `${analysis.closeEach - analysis.openEach} extra {{/each}} block(s)`;

	return (
		<div className="control-field control-field--wide">
			<span>{label}</span>
			<div className="template-editor">
				<div className="template-editor-wrapper">
					<CodeEditor
						value={value}
						onChange={onChange}
						placeholder={placeholder}
						disabled={disabled}
						rows={11}
						extensions={extensions}
						className="template-code-surface"
						ariaLabel={label}
					/>
				</div>
				<div className="template-editor-footer">
					<span
						className={`editor-status-chip ${
							analysis.openEach === analysis.closeEach
								? "editor-status-chip--ok"
								: "editor-status-chip--warn"
						}`}
					>
						{balanceMessage}
					</span>
					{analysis.expressions.length ? (
						analysis.expressions.slice(0, 6).map((expression) => (
							<span key={expression} className="editor-token-chip">
								{expression}
							</span>
						))
					) : (
						<span className="muted">
							Type {"{{"} to open completion. Use {"{{#each items}}"} for row
							fields.
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
