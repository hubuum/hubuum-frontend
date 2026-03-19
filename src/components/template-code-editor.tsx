"use client";

import Prism from "prismjs";
import { useMemo } from "react";
import Editor from "react-simple-code-editor";

type TemplateCodeEditorProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
};

function analyzeTemplate(value: string) {
	const openEach = (value.match(/\{\{#each\s+[^}]+\}\}/g) ?? []).length;
	const closeEach = (value.match(/\{\{\/each\}\}/g) ?? []).length;
	const expressionMatches = value.match(/\{\{([^}]+)\}\}/g) ?? [];
	const expressions = Array.from(
		new Set(
			expressionMatches
				.map((match) => match.replaceAll("{", "").replaceAll("}", "").trim())
				.filter((match) => match !== "/each" && !match.startsWith("#each")),
		),
	);

	return {
		openEach,
		closeEach,
		expressions,
	};
}

if (!Prism.languages.hubuumTemplate) {
	Prism.languages.hubuumTemplate = {
		block: {
			pattern: /\{\{#each\s+[^}]+\}\}|\{\{\/each\}\}/,
			inside: {
				delimiter: {
					pattern: /^\{\{|\}\}$/,
					alias: "template-delimiter",
				},
				keyword: {
					pattern: /#each|\/each/,
					alias: "template-keyword",
				},
				path: {
					pattern: /[A-Za-z_][\w.]*/,
					alias: "template-path",
				},
			},
		},
		expression: {
			pattern: /\{\{(?!#each|\/each)[^}]+\}\}/,
			inside: {
				delimiter: {
					pattern: /^\{\{|\}\}$/,
					alias: "template-delimiter",
				},
				path: {
					pattern: /[A-Za-z_][\w.]*/,
					alias: "template-path",
				},
			},
		},
	};
}

export function TemplateCodeEditor({
	label,
	value,
	onChange,
	placeholder,
	disabled,
}: TemplateCodeEditorProps) {
	const analysis = useMemo(() => analyzeTemplate(value), [value]);

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
				<Editor
					value={value}
					onValueChange={onChange}
					highlight={(code: string) =>
						Prism.highlight(
							code,
							Prism.languages.hubuumTemplate,
							"hubuumTemplate",
						)
					}
					padding={16}
					textareaClassName="code-input-textarea"
					preClassName="code-input-pre"
					className="code-input-shell"
					tabSize={2}
					insertSpaces
					ignoreTabKey={false}
					autoFocus={false}
					disabled={disabled}
					placeholder={placeholder}
					aria-label={label}
				/>
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
							Use expressions like `{"{{this.name}}"}` or `{"{{meta.count}}"}`.
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
