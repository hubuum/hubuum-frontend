"use client";

import { ChangeEvent, Fragment, ReactNode } from "react";

type TemplateCodeEditorProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

function renderHighlightedLine(line: string, lineIndex: number): ReactNode {
  const pattern = /\{\{#each\s+([^}]+)\}\}|\{\{\/each\}\}|\{\{([^}]+)\}\}/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(line);

  while (match) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    if (match[1]) {
      parts.push(
        <Fragment key={`${lineIndex}-${match.index}`}>
          <span className="code-token code-token--block">{"{{#each "}</span>
          <span className="code-token code-token--path">{match[1]}</span>
          <span className="code-token code-token--block">{"}}"}</span>
        </Fragment>
      );
    } else if (match[0] === "{{/each}}") {
      parts.push(
        <span key={`${lineIndex}-${match.index}`} className="code-token code-token--block">
          {match[0]}
        </span>
      );
    } else if (match[2]) {
      parts.push(
        <Fragment key={`${lineIndex}-${match.index}`}>
          <span className="code-token code-token--expression">{"{{"}</span>
          <span className="code-token code-token--path">{match[2].trim()}</span>
          <span className="code-token code-token--expression">{"}}"}</span>
        </Fragment>
      );
    }

    lastIndex = match.index + match[0].length;
    match = pattern.exec(line);
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  if (parts.length === 0) {
    return "\u00A0";
  }

  return parts;
}

export function TemplateCodeEditor({ label, value, onChange, placeholder, disabled }: TemplateCodeEditorProps) {
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  const previewLines = value.split("\n");

  return (
    <div className="control-field control-field--wide">
      <span>{label}</span>
      <div className="template-editor">
        <label className="template-editor-pane">
          <span className="template-editor-title">Editor</span>
          <textarea
            className="code-input"
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            spellCheck={false}
            disabled={disabled}
          />
        </label>
        <div className="template-editor-pane">
          <span className="template-editor-title">Syntax preview</span>
          <pre className="code-preview" aria-hidden="true">
            {value.trim() ? (
              previewLines.map((line, index) => (
                <Fragment key={`${index}-${line}`}>
                  {renderHighlightedLine(line, index)}
                  {index < previewLines.length - 1 ? "\n" : null}
                </Fragment>
              ))
            ) : (
              <span className="code-token code-token--muted">Template preview will appear here.</span>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
