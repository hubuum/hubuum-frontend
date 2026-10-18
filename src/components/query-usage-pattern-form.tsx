"use client";

import { useState } from "react";
import type {
	QueryUsagePatternSchema,
	QueryUsageValueType,
} from "@/lib/api/generated/models";
import {
	QUERY_USAGE_OPERATIONS,
	queryUsageOperations,
	queryUsagePatternError,
} from "@/lib/query-usage";

export function QueryUsagePatternForm({
	initial,
	label,
	submitLabel,
	disabled,
	onSubmit,
	onCancel,
}: {
	initial?: QueryUsagePatternSchema;
	label: string;
	submitLabel: string;
	disabled: boolean;
	onSubmit: (pattern: QueryUsagePatternSchema) => void;
	onCancel?: () => void;
}) {
	const [pattern, setPattern] = useState<QueryUsagePatternSchema>(
		initial ?? { path: "", value_type: "string", operations: ["equals"] },
	);
	const [error, setError] = useState<string | null>(null);
	return (
		<form
			className="stack"
			aria-label={label}
			onSubmit={(event) => {
				event.preventDefault();
				const problem = queryUsagePatternError(pattern);
				setError(problem);
				if (!problem) onSubmit(pattern);
			}}
		>
			<fieldset className="stack" disabled={disabled}>
				<legend>{label}</legend>
				<div className="form-grid">
					<label className="control-field">
						<span>JSON path</span>
						<input
							required
							value={pattern.path}
							placeholder="hardware,serial_number"
							onChange={(event) =>
								setPattern({ ...pattern, path: event.target.value })
							}
						/>
					</label>
					<label className="control-field">
						<span>Value type</span>
						<select
							value={pattern.value_type}
							onChange={(event) => {
								const value_type = event.target.value as QueryUsageValueType;
								setPattern({ ...pattern, value_type, operations: ["equals"] });
							}}
						>
							<option value="string">Text</option>
							<option value="numeric">Number</option>
							<option value="boolean">True / false</option>
						</select>
					</label>
				</div>
				<p className="muted">
					Separate JSON path segments with commas. Numeric operations use the
					server&apos;s integer query operands.
				</p>
				<fieldset>
					<legend>Operations</legend>
					<div className="action-row">
						{queryUsageOperations(pattern.value_type).map((operation) => (
							<label className="checkbox-row" key={operation}>
								<input
									type="checkbox"
									checked={pattern.operations.includes(operation)}
									onChange={(event) =>
										setPattern({
											...pattern,
											operations: event.target.checked
												? [...pattern.operations, operation]
												: pattern.operations.filter(
														(item) => item !== operation,
													),
										})
									}
								/>
								{QUERY_USAGE_OPERATIONS[operation]}
							</label>
						))}
					</div>
				</fieldset>
				{error ? <p role="alert">{error}</p> : null}
				<div className="form-actions">
					<button type="submit">{submitLabel}</button>
					{onCancel ? (
						<button type="button" className="ghost" onClick={onCancel}>
							Cancel editing
						</button>
					) : null}
				</div>
			</fieldset>
		</form>
	);
}
