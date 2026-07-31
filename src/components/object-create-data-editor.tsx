"use client";

import { useMemo, useState } from "react";

import { JsonEditor } from "@/components/json-editor";
import {
	buildObjectCreateDataModel,
	isObjectCreatePathAllowed,
	removeObjectCreateDataValue,
	type ObjectCreateDataField,
} from "@/lib/object-create-data";
import {
	createObjectDataFieldValue,
	getObjectDataValue,
	parseObjectDataPath,
	setObjectDataValue,
	type ObjectDataFieldType,
} from "@/lib/object-data-editing";
import { parseJsonText, validateJsonAgainstSchema } from "@/lib/json-inspector";

type ObjectCreateDataEditorProps = {
	disabled?: boolean;
	onChange: (value: string) => void;
	sampleData: unknown[];
	schema: unknown;
	validationEnabled: boolean;
	value: string;
};

const NEW_FIELD_OPTION = "__new_field__";
const FIELD_TYPES: Array<{ label: string; value: ObjectDataFieldType }> = [
	{ label: "Text", value: "string" },
	{ label: "Number", value: "number" },
	{ label: "True / false", value: "boolean" },
	{ label: "Object", value: "object" },
	{ label: "Array", value: "array" },
	{ label: "Null", value: "null" },
];

const FIELD_TYPE_LABELS = Object.fromEntries(
	FIELD_TYPES.map((fieldType) => [fieldType.value, fieldType.label]),
) as Record<ObjectDataFieldType, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyData(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function structuredValueSummary(value: unknown): string {
	if (Array.isArray(value)) {
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	}
	if (isRecord(value)) {
		const count = Object.keys(value).length;
		return `${count} field${count === 1 ? "" : "s"}`;
	}
	return "null";
}

function fieldTypeLabel(field: ObjectCreateDataField): string {
	return field.types.map((type) => FIELD_TYPE_LABELS[type]).join(" / ");
}

function ObjectCreateFieldInput({
	disabled,
	field,
	onChange,
	onOpenJson,
	value,
}: {
	disabled: boolean;
	field: ObjectCreateDataField;
	onChange: (value: unknown) => void;
	onOpenJson: () => void;
	value: unknown;
}) {
	const type = field.types[0] ?? "string";
	if (type === "boolean") {
		return (
			<select
				aria-label={`${field.label} value`}
				value={value === true ? "true" : "false"}
				onChange={(event) => onChange(event.target.value === "true")}
				disabled={disabled}
			>
				<option value="false">False</option>
				<option value="true">True</option>
			</select>
		);
	}
	if (type === "number") {
		return (
			<input
				aria-label={`${field.label} value`}
				type="number"
				step="any"
				value={typeof value === "number" ? String(value) : ""}
				onChange={(event) => {
					const next = event.target.value;
					onChange(next === "" ? null : Number(next));
				}}
				disabled={disabled}
			/>
		);
	}
	if (type === "object" || type === "array") {
		return (
			<div className="object-create-structured-value">
				<span>{structuredValueSummary(value)}</span>
				<button
					type="button"
					className="ghost"
					onClick={onOpenJson}
					disabled={disabled}
				>
					Edit in JSON
				</button>
			</div>
		);
	}
	if (type === "null") {
		return <code className="object-create-null-value">null</code>;
	}
	return (
		<input
			aria-label={`${field.label} value`}
			value={typeof value === "string" ? value : ""}
			onChange={(event) => onChange(event.target.value)}
			disabled={disabled}
		/>
	);
}

export function ObjectCreateDataEditor({
	disabled = false,
	onChange,
	sampleData,
	schema,
	validationEnabled,
	value,
}: ObjectCreateDataEditorProps) {
	const [activeTab, setActiveTab] = useState<"data" | "json">("data");
	const [isAddRowOpen, setAddRowOpen] = useState(false);
	const [draftFieldId, setDraftFieldId] = useState("");
	const [draftKnownValue, setDraftKnownValue] = useState<unknown>("");
	const [newFieldPath, setNewFieldPath] = useState("");
	const [newFieldType, setNewFieldType] =
		useState<ObjectDataFieldType>("string");
	const [newFieldValue, setNewFieldValue] = useState("");
	const [newFieldError, setNewFieldError] = useState<string | null>(null);
	const parsed = useMemo(() => parseJsonText(value), [value]);
	const data =
		parsed.kind === "success" && isRecord(parsed.value) ? parsed.value : null;
	const model = useMemo(
		() =>
			buildObjectCreateDataModel(
				schema,
				data ? [data, ...sampleData] : sampleData,
			),
		[data, sampleData, schema],
	);
	const activeFields = data
		? model.fields.filter((field) => getObjectDataValue(data, field.path).found)
		: [];
	const availableFields = data
		? model.fields.filter(
				(field) => !getObjectDataValue(data, field.path).found,
			)
		: model.fields;
	const schemaFields = availableFields.filter(
		(field) => field.source === "schema",
	);
	const observedFields = availableFields.filter(
		(field) => field.source === "sampled",
	);
	const draftField = model.fields.find((field) => field.id === draftFieldId);
	const validation = useMemo(
		() =>
			validationEnabled && parsed.kind === "success"
				? validateJsonAgainstSchema(parsed.value, schema)
				: null,
		[parsed, schema, validationEnabled],
	);

	function updateData(nextData: unknown) {
		onChange(stringifyData(nextData));
	}

	function addKnownField(fieldId: string, fieldValue: unknown): boolean {
		if (!data) return false;
		const field = model.fields.find((candidate) => candidate.id === fieldId);
		if (!field) return false;
		const updated = setObjectDataValue(data, field.path, fieldValue);
		if (!updated.ok) {
			setNewFieldError(updated.error);
			return false;
		}
		setNewFieldError(null);
		updateData(updated.value);
		return true;
	}

	function updateField(field: ObjectCreateDataField, fieldValue: unknown) {
		if (!data) return;
		const updated = setObjectDataValue(data, field.path, fieldValue);
		if (updated.ok) updateData(updated.value);
	}

	function removeField(field: ObjectCreateDataField) {
		if (!data || field.required) return;
		updateData(removeObjectCreateDataValue(data, field.path));
	}

	function addNewField(): boolean {
		if (!data) return false;
		const parsedPath = parseObjectDataPath(newFieldPath);
		if (!parsedPath.ok) {
			setNewFieldError(parsedPath.error);
			return false;
		}
		if (parsedPath.segments.some((segment) => typeof segment === "number")) {
			setNewFieldError("Use the JSON tab to add fields inside arrays.");
			return false;
		}
		const path = parsedPath.segments as string[];
		if (!isObjectCreatePathAllowed(schema, path)) {
			setNewFieldError("This field is not allowed by the class schema.");
			return false;
		}
		if (getObjectDataValue(data, path).found) {
			setNewFieldError("That data field already exists.");
			return false;
		}
		const fieldValue = createObjectDataFieldValue(newFieldType, newFieldValue);
		if (!fieldValue.ok) {
			setNewFieldError(fieldValue.error);
			return false;
		}
		const updated = setObjectDataValue(data, path, fieldValue.value);
		if (!updated.ok) {
			setNewFieldError(updated.error);
			return false;
		}
		updateData(updated.value);
		setNewFieldPath("");
		setNewFieldType("string");
		setNewFieldValue("");
		setNewFieldError(null);
		return true;
	}

	function closeAddRow() {
		setAddRowOpen(false);
		setDraftFieldId("");
		setDraftKnownValue("");
		setNewFieldPath("");
		setNewFieldType("string");
		setNewFieldValue("");
		setNewFieldError(null);
	}

	function addDraftField() {
		if (!draftFieldId) {
			setNewFieldError("Choose a field to add.");
			return;
		}
		const added =
			draftFieldId === NEW_FIELD_OPTION
				? addNewField()
				: addKnownField(draftFieldId, draftKnownValue);
		if (added) closeAddRow();
	}

	function onTabKeyDown(
		event: React.KeyboardEvent<HTMLButtonElement>,
		tab: "data" | "json",
	) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const nextTab = tab === "data" ? "json" : "data";
		setActiveTab(nextTab);
		window.setTimeout(
			() => document.getElementById(`object-create-${nextTab}-tab`)?.focus(),
			0,
		);
	}

	return (
		<section className="object-create-data-editor">
			<div
				className="object-create-data-tabs"
				role="tablist"
				aria-label="Object data editor"
			>
				<button
					type="button"
					id="object-create-data-tab"
					role="tab"
					aria-selected={activeTab === "data"}
					aria-controls="object-create-data-panel"
					tabIndex={activeTab === "data" ? 0 : -1}
					className={activeTab === "data" ? "is-active" : "ghost"}
					onClick={() => setActiveTab("data")}
					onKeyDown={(event) => onTabKeyDown(event, "data")}
				>
					<span className="object-create-data-tab-index" aria-hidden="true">
						01
					</span>
					<span className="object-create-data-tab-copy">
						<strong>Data</strong>
						<small>Guided fields</small>
					</span>
				</button>
				<button
					type="button"
					id="object-create-json-tab"
					role="tab"
					aria-selected={activeTab === "json"}
					aria-controls="object-create-json-panel"
					tabIndex={activeTab === "json" ? 0 : -1}
					className={activeTab === "json" ? "is-active" : "ghost"}
					onClick={() => setActiveTab("json")}
					onKeyDown={(event) => onTabKeyDown(event, "json")}
				>
					<span className="object-create-data-tab-index" aria-hidden="true">
						02
					</span>
					<span className="object-create-data-tab-copy">
						<strong>JSON</strong>
						<small>Raw document</small>
					</span>
				</button>
			</div>

			{activeTab === "data" ? (
				<div
					id="object-create-data-panel"
					role="tabpanel"
					aria-labelledby="object-create-data-tab"
					className="object-create-data-panel"
				>
					{!data ? (
						<div className="error-banner object-create-data-invalid">
							Data must be a valid JSON object. Open the JSON tab to fix it.
							<button type="button" onClick={() => setActiveTab("json")}>
								Open JSON
							</button>
						</div>
					) : (
						<>
							<div className="object-create-field-list">
								<div className="object-create-field-header" aria-hidden="true">
									<span>Field</span>
									<span>Type</span>
									<span>Value</span>
									<span />
								</div>
								{activeFields.map((field) => {
									const lookup = getObjectDataValue(data, field.path);
									if (!lookup.found) return null;
									return (
										<div className="object-create-field" key={field.id}>
											<div className="object-create-field-label">
												<strong>{field.label}</strong>
												<span>
													{field.source === "schema"
														? field.required
															? "Required schema field"
															: "Schema field"
														: "Observed in this class"}
												</span>
											</div>
											<span className="object-create-field-type">
												{fieldTypeLabel(field)}
											</span>
											<ObjectCreateFieldInput
												disabled={disabled}
												field={field}
												value={lookup.value}
												onChange={(nextValue) => updateField(field, nextValue)}
												onOpenJson={() => setActiveTab("json")}
											/>
											{!field.required ? (
												<button
													type="button"
													className="ghost object-create-field-remove"
													onClick={() => removeField(field)}
													disabled={disabled}
													aria-label={`Remove ${field.label}`}
													title={`Remove ${field.label}`}
												>
													Remove
												</button>
											) : (
												<span aria-hidden="true" />
											)}
										</div>
									);
								})}

								{isAddRowOpen ? (
									<div className="object-create-field object-create-field--draft">
										<div className="object-create-draft-field">
											{draftFieldId === NEW_FIELD_OPTION ? (
												<input
													aria-label="New field path"
													value={newFieldPath}
													onChange={(event) => {
														setNewFieldPath(event.target.value);
														setNewFieldError(null);
													}}
													placeholder="New field path"
												/>
											) : (
												<select
													aria-label="Field to add"
													value={draftFieldId}
													onChange={(event) => {
														const nextFieldId = event.target.value;
														setDraftFieldId(nextFieldId);
														const nextField = model.fields.find(
															(field) => field.id === nextFieldId,
														);
														setDraftKnownValue(nextField?.initialValue ?? "");
														setNewFieldError(null);
													}}
												>
													<option value="">Choose a field…</option>
													{schemaFields.length ? (
														<optgroup label="Class schema">
															{schemaFields.map((field) => (
																<option key={field.id} value={field.id}>
																	{field.label}
																</option>
															))}
														</optgroup>
													) : null}
													{observedFields.length ? (
														<optgroup label="Observed in this class">
															{observedFields.map((field) => (
																<option key={field.id} value={field.id}>
																	{field.label}
																</option>
															))}
														</optgroup>
													) : null}
													{model.allowsNewFields ? (
														<option value={NEW_FIELD_OPTION}>New field…</option>
													) : null}
												</select>
											)}
										</div>

										{draftFieldId === NEW_FIELD_OPTION ? (
											<select
												aria-label="New field type"
												value={newFieldType}
												onChange={(event) => {
													setNewFieldType(
														event.target.value as ObjectDataFieldType,
													);
													setNewFieldValue("");
												}}
											>
												{FIELD_TYPES.map((type) => (
													<option key={type.value} value={type.value}>
														{type.label}
													</option>
												))}
											</select>
										) : (
											<span className="object-create-field-type">
												{draftField ? fieldTypeLabel(draftField) : "—"}
											</span>
										)}

										<div className="object-create-draft-value">
											{draftFieldId === NEW_FIELD_OPTION &&
											(newFieldType === "string" ||
												newFieldType === "number") ? (
												<input
													aria-label="New field value"
													type={newFieldType === "number" ? "number" : "text"}
													step={newFieldType === "number" ? "any" : undefined}
													value={newFieldValue}
													onChange={(event) =>
														setNewFieldValue(event.target.value)
													}
													placeholder="Initial value"
												/>
											) : null}
											{draftFieldId === NEW_FIELD_OPTION &&
											newFieldType === "boolean" ? (
												<select
													aria-label="New field value"
													value={newFieldValue || "false"}
													onChange={(event) =>
														setNewFieldValue(event.target.value)
													}
												>
													<option value="false">False</option>
													<option value="true">True</option>
												</select>
											) : null}
											{draftFieldId === NEW_FIELD_OPTION &&
											(newFieldType === "object" ||
												newFieldType === "array" ||
												newFieldType === "null") ? (
												<span className="muted">
													Starts as{" "}
													{newFieldType === "object"
														? "{}"
														: newFieldType === "array"
															? "[]"
															: "null"}
												</span>
											) : null}
											{draftField ? (
												<ObjectCreateFieldInput
													disabled={disabled}
													field={draftField}
													value={draftKnownValue}
													onChange={setDraftKnownValue}
													onOpenJson={() => {
														if (addKnownField(draftField.id, draftKnownValue)) {
															closeAddRow();
															setActiveTab("json");
														}
													}}
												/>
											) : null}
										</div>

										<div className="object-create-draft-actions">
											<button type="button" onClick={addDraftField}>
												Add
											</button>
											<button
												type="button"
												className="ghost"
												onClick={closeAddRow}
											>
												Cancel
											</button>
										</div>
									</div>
								) : null}
							</div>

							{!isAddRowOpen ? (
								<button
									type="button"
									className="ghost object-create-add-field"
									onClick={() => {
										setAddRowOpen(true);
										setNewFieldError(null);
									}}
									disabled={
										disabled ||
										(!availableFields.length && !model.allowsNewFields)
									}
									title={
										availableFields.length || model.allowsNewFields
											? "Add another data field"
											: "All allowed fields are present"
									}
								>
									<span aria-hidden="true">+</span> Add field
								</button>
							) : null}
						</>
					)}

					{newFieldError ? (
						<div className="error-banner object-create-data-error" role="alert">
							{newFieldError}
						</div>
					) : null}
					{validation && validation.issues.length > 0 ? (
						<div className="object-create-schema-issues" role="status">
							<strong>
								{validation.issues.length} schema issue
								{validation.issues.length === 1 ? "" : "s"}
							</strong>
							<ul>
								{validation.issues.slice(0, 4).map((issue) => (
									<li key={`${issue.path}-${issue.message}`}>
										<code>{issue.path}</code>: {issue.message}
									</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			) : (
				<div
					id="object-create-json-panel"
					role="tabpanel"
					aria-labelledby="object-create-json-tab"
					className="object-create-json-panel"
				>
					<JsonEditor
						id="object-create-data"
						label="Data (JSON)"
						value={value}
						onChange={onChange}
						placeholder='{"hostname":"srv-web-01","env":"prod"}'
						mode="data"
						rows={12}
						disabled={disabled}
						validationEnabled={validationEnabled}
						validationSchema={schema}
						helperText={
							validationEnabled
								? "This class validates object data against its JSON schema."
								: "Changes here are reflected in the Data tab."
						}
					/>
				</div>
			)}
		</section>
	);
}
