"use client";

import {
	acceptCompletion,
	autocompletion,
} from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { closePercentBrace, jinja } from "@codemirror/lang-jinja";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { useMemo } from "react";

import { CodeEditor } from "@/components/code-editor";
import type { ReportScopeKind } from "@/lib/api/reporting";
import { createTemplateCompletionSource } from "@/lib/template-completion";
import { analyzeTemplate } from "@/lib/template-suggestions";

type TemplateCodeEditorProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	scopeKind?: ReportScopeKind;
	relationHydrated?: boolean;
	relationAliases?: string[];
};

export function TemplateCodeEditor({
	label,
	value,
	onChange,
	placeholder,
	disabled,
	scopeKind,
	relationHydrated = false,
	relationAliases,
}: TemplateCodeEditorProps) {
	const analysis = useMemo(() => analyzeTemplate(value), [value]);

	const relationAliasesKey = (relationAliases ?? []).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: relationAliasesKey is a stable proxy for the array
	const extensions = useMemo<Extension[]>(
		() => [
			jinja(),
			closePercentBrace,
			keymap.of([
				{
					key: "Tab",
					run: (view) =>
						acceptCompletion(view) || Boolean(indentWithTab.run?.(view)),
				},
			]),
			autocompletion({
				activateOnTyping: true,
				closeOnBlur: true,
				selectOnOpen: true,
				maxRenderedOptions: 14,
				tooltipClass: () => "template-completion-tooltip",
				optionClass: () => "template-completion-option",
				override: [
					createTemplateCompletionSource({
						scopeKind,
						relationHydrated,
						relationAliases,
					}),
				],
			}),
		],
		// relationAliasesKey is a stable string proxy for the array identity.
		[scopeKind, relationHydrated, relationAliasesKey],
	);

	const balanceMessage =
		analysis.openEach === analysis.closeEach
			? "Loop blocks balanced"
			: analysis.openEach > analysis.closeEach
				? `${analysis.openEach - analysis.closeEach} unclosed {% for %} block(s)`
				: `${analysis.closeEach - analysis.openEach} extra {% endfor %} block(s)`;

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
							Type {"{{"} for expressions or {"{%"} for loops. Use{" "}
							{"{% for item in items %}"} for row fields.
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
