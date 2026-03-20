"use client";

import type { ChangeEvent } from "react";
import { useMemo, useRef } from "react";

import { CodeEditor } from "@/components/code-editor";
import { readJsonFileAsPrettyText } from "@/lib/json-file";
import {
	analyzeJsonSchema,
	formatJsonText,
	parseJsonText,
	summarizeJsonDocument,
	validateJsonAgainstSchema,
} from "@/lib/json-inspector";
import { json } from "@codemirror/lang-json";

type JsonEditorProps = {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	rows?: number;
	mode: "schema" | "data";
	helperText?: string;
	validationSchema?: unknown;
	validationEnabled?: boolean;
};

function renderSyntaxErrorMessage(
	message: string,
	line: number | null,
	column: number | null,
): string {
	if (line === null || column === null) {
		return message;
	}

	return `${message} Line ${line}, column ${column}.`;
}

export function JsonEditor({
	id,
	label,
	value,
	onChange,
	placeholder,
	disabled = false,
	rows = 8,
	mode,
	helperText,
	validationSchema,
	validationEnabled = false,
}: JsonEditorProps) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const jsonExtensions = useMemo(() => [json()], []);
	const parsed = useMemo(() => parseJsonText(value), [value]);
	const formattedValue = useMemo(() => formatJsonText(value), [value]);

	const documentSummary = useMemo(() => {
		if (parsed.kind !== "success") {
			return [];
		}

		return summarizeJsonDocument(parsed.value);
	}, [parsed]);

	const schemaAnalysis = useMemo(() => {
		if (mode !== "schema" || parsed.kind !== "success") {
			return null;
		}

		return analyzeJsonSchema(parsed.value);
	}, [mode, parsed]);

	const dataValidation = useMemo(() => {
		if (
			mode !== "data" ||
			parsed.kind !== "success" ||
			!validationEnabled ||
			validationSchema === undefined
		) {
			return null;
		}

		return validateJsonAgainstSchema(parsed.value, validationSchema);
	}, [mode, parsed, validationEnabled, validationSchema]);

	async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		input.value = "";

		if (!file) {
			return;
		}

		try {
			const jsonText = await readJsonFileAsPrettyText(file);
			onChange(jsonText);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to read JSON file.";
			window.alert(message);
		}
	}

	function onFormat() {
		if (!formattedValue) {
			return;
		}

		onChange(formattedValue);
	}

	return (
		<div className="json-editor">
			<div className="json-editor-header">
				<div className="json-editor-label">
					<span>{label}</span>
				</div>

				<div className="json-editor-actions">
					<button
						type="button"
						className="ghost"
						onClick={() => fileInputRef.current?.click()}
						disabled={disabled}
					>
						Load JSON file
					</button>
					<button
						type="button"
						className="ghost"
						onClick={onFormat}
						disabled={disabled || !formattedValue}
					>
						Format JSON
					</button>
				</div>
			</div>

			<CodeEditor
				value={value}
				onChange={onChange}
				placeholder={placeholder}
				disabled={disabled}
				rows={rows}
				extensions={jsonExtensions}
				className="json-code-surface"
				inputId={id}
				ariaLabel={label}
			/>
			<input
				ref={fileInputRef}
				className="json-editor-file"
				type="file"
				accept=".json,application/json"
				onChange={onFileChange}
			/>

			{helperText ? <div className="muted">{helperText}</div> : null}

			<div className="json-editor-meta">
				{parsed.kind === "empty" ? (
					<div className="muted">JSON field is empty.</div>
				) : null}

				{parsed.kind === "error" ? (
					<div className="error-banner">
						{renderSyntaxErrorMessage(
							parsed.error.message,
							parsed.error.line,
							parsed.error.column,
						)}
					</div>
				) : null}

				{documentSummary.length > 0 ? (
					<div className="json-editor-panel">
						<strong>Document summary</strong>
						<ul className="json-editor-list">
							{documentSummary.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					</div>
				) : null}

				{schemaAnalysis ? (
					<div className="json-editor-panel">
						<strong>Schema summary</strong>
						{schemaAnalysis.summary.length > 0 ? (
							<ul className="json-editor-list">
								{schemaAnalysis.summary.map((item) => (
									<li key={item}>{item}</li>
								))}
							</ul>
						) : null}
						{schemaAnalysis.issues.length === 0 ? (
							<div className="muted">
								Schema structure looks valid for the supported preview checks.
							</div>
						) : (
							<ul className="json-editor-list json-editor-list--errors">
								{schemaAnalysis.issues.map((issue) => (
									<li key={`${issue.path}-${issue.message}`}>
										<code>{issue.path}</code>: {issue.message}
									</li>
								))}
							</ul>
						)}
					</div>
				) : null}

				{mode === "data" &&
				validationEnabled &&
				validationSchema === undefined ? (
					<div className="json-editor-panel">
						<strong>Schema preview</strong>
						<div className="muted">
							This class validates object data, but no class schema is available
							in the current payload.
						</div>
					</div>
				) : null}

				{dataValidation ? (
					<div className="json-editor-panel">
						<strong>Schema preview</strong>
						{dataValidation.note ? (
							<div className="muted">{dataValidation.note}</div>
						) : null}
						{dataValidation.issues.length === 0 ? (
							<div className="muted">
								Current JSON matches the available class schema preview.
							</div>
						) : (
							<ul className="json-editor-list json-editor-list--errors">
								{dataValidation.issues.map((issue) => (
									<li key={`${issue.path}-${issue.message}`}>
										<code>{issue.path}</code>: {issue.message}
									</li>
								))}
							</ul>
						)}
					</div>
				) : null}
			</div>
		</div>
	);
}
