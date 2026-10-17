"use client";

import { useId, useRef } from "react";
import { ResourcePicker } from "@/components/resource-picker";
import {
	dateInputValue,
	emptyCondition,
	fieldOperators,
	fieldsFor,
	newSearchNode,
	OPERATOR_LABELS,
	SEARCH_FIELDS,
	type SearchCondition,
	type SearchNode,
	type SearchTarget,
} from "@/lib/advanced-search";
import type { StructuredSearchOperator } from "@/lib/api/generated/models";

export function SearchConditionEditor({
	condition,
	target,
	onChange,
}: {
	condition: SearchCondition;
	target: SearchTarget;
	onChange: (condition: SearchCondition) => void;
}) {
	const id = useId();
	const field = SEARCH_FIELDS.find((item) => item.field === condition.field);
	const available = fieldsFor(target);
	const operators = field ? fieldOperators(field.type) : [];
	const array = ["in", "all", "between"].includes(condition.operator);
	const valueKind = field?.type === "json" ? condition.valueType : field?.type;
	const updateValue = (index: number, value: string) =>
		onChange({
			...condition,
			values: condition.values.map((item, i) => (i === index ? value : item)),
		});
	return (
		<div className="stack advanced-condition">
			<div className="advanced-controls">
				<label htmlFor={`${id}-field`}>
					Field
					<select
						id={`${id}-field`}
						value={condition.field}
						onChange={(event) => {
							const next = available.find(
								(item) => item.field === event.target.value,
							);
							onChange({
								...emptyCondition(),
								field: event.target.value,
								operator: next?.type === "text" ? "icontains" : "equals",
							});
						}}
					>
						{!available.some((item) => item.field === condition.field) && (
							<option value={condition.field}>
								{condition.field} (incompatible)
							</option>
						)}
						{available.map((item) => (
							<option key={item.field} value={item.field}>
								{item.label}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-operator`}>
					Operator
					<select
						id={`${id}-operator`}
						value={condition.operator}
						onChange={(event) => {
							const operator = event.target.value;
							onChange({
								...condition,
								operator,
								values:
									operator === "between"
										? [condition.values[0] ?? "", condition.values[1] ?? ""]
										: operator === "in" || operator === "all"
											? condition.values.length
												? condition.values
												: [""]
											: [condition.values[0] ?? ""],
							});
						}}
					>
						{!operators.includes(
							condition.operator as StructuredSearchOperator,
						) && (
							<option value={condition.operator}>
								{condition.operator} (incompatible)
							</option>
						)}
						{operators.map((operator) => (
							<option key={operator} value={operator}>
								{OPERATOR_LABELS[operator] ?? operator.replaceAll("_", " ")}
							</option>
						))}
					</select>
				</label>
				{field?.type === "json" && (
					<>
						<label htmlFor={`${id}-path`}>
							JSON path
							<input
								id={`${id}-path`}
								value={condition.path}
								placeholder="hardware.cpu.count"
								onChange={(event) =>
									onChange({ ...condition, path: event.target.value })
								}
							/>
						</label>
						{condition.operator !== "is_null" && (
							<label htmlFor={`${id}-type`}>
								Value type
								<select
									id={`${id}-type`}
									value={condition.valueType}
									onChange={(event) =>
										onChange({
											...condition,
											valueType: event.target
												.value as SearchCondition["valueType"],
											values:
												condition.operator === "between" ? ["", ""] : [""],
										})
									}
								>
									<option value="text">Text</option>
									<option value="number">Number</option>
									<option value="boolean">Boolean</option>
									<option value="date">Date (UTC)</option>
								</select>
							</label>
						)}
					</>
				)}
			</div>
			{condition.operator !== "is_null" && (
				<div className="stack">
					{condition.values.map((value, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Value slots are controlled and positional, including range bounds.
						<div className="advanced-value" key={`${id}-value-${index}`}>
							{valueKind === "collection" ? (
								<ResourcePicker
									kind="collection"
									value={value}
									label={`Collection ${index + 1}`}
									onChange={(value) => updateValue(index, value)}
									showIdentity
								/>
							) : (
								<label htmlFor={`${id}-value-${index}`}>
									{condition.operator === "between"
										? index === 0
											? "Lower bound"
											: "Upper bound"
										: array
											? `Value ${index + 1}`
											: "Value"}
									{valueKind === "date" ? " (UTC)" : ""}
									{valueKind === "boolean" ? (
										<select
											id={`${id}-value-${index}`}
											value={value}
											onChange={(event) =>
												updateValue(index, event.target.value)
											}
										>
											<option value="">Choose a value</option>
											<option value="true">True</option>
											<option value="false">False</option>
										</select>
									) : (
										<input
											id={`${id}-value-${index}`}
											type={
												valueKind === "date"
													? !value || /^\d{4}-\d{2}-\d{2}T/.test(value)
														? "datetime-local"
														: "text"
													: valueKind === "integer" || valueKind === "number"
														? "number"
														: "text"
											}
											step={valueKind === "integer" ? "1" : "any"}
											value={
												valueKind === "date" ? dateInputValue(value) : value
											}
											onChange={(event) =>
												updateValue(index, event.target.value)
											}
										/>
									)}
								</label>
							)}
							{array && condition.operator !== "between" && (
								<button
									type="button"
									className="ghost"
									aria-label={`Remove value ${index + 1}`}
									onClick={() =>
										onChange({
											...condition,
											values: condition.values.filter((_, i) => i !== index),
										})
									}
								>
									Remove value
								</button>
							)}
						</div>
					))}
					{array && condition.operator !== "between" && (
						<button
							type="button"
							className="ghost"
							disabled={condition.values.length >= 50}
							onClick={() =>
								onChange({ ...condition, values: [...condition.values, ""] })
							}
						>
							Add value
						</button>
					)}
				</div>
			)}
		</div>
	);
}

export function SearchNodeEditor({
	node,
	target,
	onChange,
	onRemove,
	location = "1",
}: {
	node: SearchNode;
	target: SearchTarget;
	onChange: (node: SearchNode) => void;
	onRemove?: () => void;
	location?: string;
}) {
	const id = useId();
	const addCondition = useRef<HTMLButtonElement>(null);
	const addRelatedFilter = useRef<HTMLButtonElement>(null);
	return (
		<fieldset
			className={`stack advanced-group${node.negate ? " advanced-negated" : ""}`}
		>
			<legend>
				{node.kind === "group"
					? "Group"
					: node.kind === "related"
						? "Related objects"
						: "Condition"}{" "}
				{location}
			</legend>
			<div className="advanced-controls">
				<label className="checkbox-label">
					<input
						type="checkbox"
						checked={node.negate}
						onChange={(event) =>
							onChange({ ...node, negate: event.target.checked })
						}
					/>
					NOT — negate this{" "}
					{node.kind === "group" ? "whole group" : "condition"}
				</label>
				{onRemove && (
					<button type="button" className="ghost" onClick={onRemove}>
						Remove {node.kind === "group" ? "group" : "condition"} {location}
					</button>
				)}
			</div>
			{node.kind === "field" && (
				<SearchConditionEditor
					condition={node.condition}
					target={target}
					onChange={(condition) => onChange({ ...node, condition })}
				/>
			)}
			{node.kind === "group" && (
				<>
					<label htmlFor={`${id}-mode`}>
						Match
						<select
							id={`${id}-mode`}
							value={node.mode}
							onChange={(event) =>
								onChange({ ...node, mode: event.target.value as "and" | "or" })
							}
						>
							<option value="and">Match all (AND)</option>
							<option value="or">Match any (OR)</option>
						</select>
					</label>
					{node.children.map((child, index) => (
						<SearchNodeEditor
							key={child.id}
							node={child}
							target={target}
							location={`${location}.${index + 1}`}
							onChange={(updated) =>
								onChange({
									...node,
									children: node.children.map((item) =>
										item.id === child.id ? updated : item,
									),
								})
							}
							onRemove={() => {
								onChange({
									...node,
									children: node.children.filter(
										(item) => item.id !== child.id,
									),
								});
								addCondition.current?.focus();
							}}
						/>
					))}
					<div className="advanced-controls">
						<button
							ref={addCondition}
							type="button"
							className="ghost"
							onClick={() =>
								onChange({
									...node,
									children: [...node.children, newSearchNode()],
								})
							}
						>
							Add condition
						</button>
						<button
							type="button"
							className="ghost"
							onClick={() =>
								onChange({
									...node,
									children: [...node.children, newSearchNode("group")],
								})
							}
						>
							Add group
						</button>
						{target === "object" && (
							<button
								type="button"
								className="ghost"
								onClick={() =>
									onChange({
										...node,
										children: [...node.children, newSearchNode("related")],
									})
								}
							>
								Add related-object condition
							</button>
						)}
					</div>
				</>
			)}
			{node.kind === "related" && (
				<>
					<p>
						At least one visible object in this class must satisfy all
						conditions below, along a visible bidirectional path. NOT means no
						such object exists.
					</p>
					<ResourcePicker
						kind="class"
						value={node.classId}
						label="Related object class"
						onChange={(classId) => onChange({ ...node, classId })}
						showIdentity
					/>
					<label htmlFor={`${id}-depth`}>
						Traversal depth (1–10)
						<input
							id={`${id}-depth`}
							type="number"
							min="1"
							max="10"
							value={node.depth}
							onChange={(event) =>
								onChange({ ...node, depth: event.target.value })
							}
						/>
					</label>
					{node.filters.length === 0 && (
						<p>
							Any visible object in the selected class may satisfy this
							condition.
						</p>
					)}
					{node.filters.map((filter, index) => (
						<fieldset
							className="stack advanced-group"
							// biome-ignore lint/suspicious/noArrayIndexKey: Filter slots are fully controlled by this ordered predicate list.
							key={`${id}-filter-${index}`}
						>
							<legend>Related filter {index + 1}</legend>
							<SearchConditionEditor
								condition={filter}
								target="object"
								onChange={(condition) =>
									onChange({
										...node,
										filters: node.filters.map((item, i) =>
											i === index ? condition : item,
										),
									})
								}
							/>
							<button
								type="button"
								className="ghost"
								onClick={() => {
									onChange({
										...node,
										filters: node.filters.filter((_, i) => i !== index),
									});
									addRelatedFilter.current?.focus();
								}}
							>
								Remove related filter {index + 1}
							</button>
						</fieldset>
					))}
					<button
						ref={addRelatedFilter}
						type="button"
						className="ghost"
						disabled={node.filters.length >= 16}
						onClick={() =>
							onChange({
								...node,
								filters: [...node.filters, emptyCondition()],
							})
						}
					>
						Add related filter
					</button>
				</>
			)}
		</fieldset>
	);
}
