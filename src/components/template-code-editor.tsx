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
import {
	analyzeTemplate,
	getJinjaProperties,
	getJinjaTags,
	getJinjaVariables,
} from "@/lib/template-suggestions";

type TemplateCodeEditorProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	scopeKind?: ReportScopeKind;
};

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
			jinja({
				tags: getJinjaTags(),
				variables: getJinjaVariables(),
				properties: (path) => getJinjaProperties(path, scopeKind),
			}),
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
			}),
		],
		[scopeKind],
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
