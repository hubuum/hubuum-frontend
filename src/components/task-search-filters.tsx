"use client";

import { type FormEvent, useState, useSyncExternalStore } from "react";
import { ResourcePicker } from "@/components/resource-picker";
import {
	defaultTaskSort,
	parseTaskFilters,
	taskFilterDraft,
	taskFilterGroups,
	taskFilterParams,
	taskSearchParams,
	taskSortError,
	taskValueLabel,
	type TaskFilterDraft,
} from "@/lib/task-discovery";

const sortOptions = [
	[defaultTaskSort, "Newest first"],
	["created_at.asc,id.asc", "Oldest first"],
	["started_at.desc,id.desc", "Most recently started"],
	["finished_at.desc,id.desc", "Most recently finished"],
	["kind.asc,id.desc", "Task kind"],
	["status.asc,id.desc", "Task status"],
];

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function TaskSearchFilters({
	search,
	limit,
	errors: appliedErrors,
	onApply,
}: {
	search: string;
	limit: number;
	errors: string[];
	onApply: (params: URLSearchParams) => void;
}) {
	const params = new URLSearchParams(search);
	// Do not accept edits before hydration attaches the controlled input handlers.
	const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
	const [draft, setDraft] = useState<TaskFilterDraft>(() =>
		taskFilterDraft(params),
	);
	const [scope, setScope] = useState(
		params.get("scope") === "all" ? "all" : "mine",
	);
	const [sort, setSort] = useState(params.get("sort") ?? defaultTaskSort);
	const [errors, setErrors] = useState(appliedErrors);
	const activeCount = [...taskFilterParams(taskFilterDraft(params))].length;

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const next = taskSearchParams(draft, scope, sort, limit);
		const validation = parseTaskFilters(next).errors;
		const sortError = taskSortError(sort);
		if (sortError) validation.push(sortError);
		if (scope === "mine" && draft.submitted_by?.trim())
			validation.push("Select All visible tasks to filter by a submitter ID.");
		setErrors(validation);
		if (!validation.length) onApply(next);
	}

	return (
		<form
			className="card stack panel-card"
			aria-label="Task search"
			aria-busy={!ready}
			inert={!ready}
			onSubmit={submit}
		>
			<h3>Find tasks{activeCount ? ` (${activeCount} filters)` : ""}</h3>
			<p className="muted">
				Filters are combined by the server. Task-specific filters select the
				applicable kinds; leave task kinds empty to search all matching kinds.
				Resource filters match recorded targets, not current membership.
			</p>
			<div className="form-grid">
				<label className="control-field">
					Task scope
					<select
						value={scope}
						onChange={(event) => setScope(event.target.value)}
					>
						<option value="mine">My tasks</option>
						<option value="all">All visible tasks</option>
					</select>
				</label>
				<label className="control-field">
					Task sort order
					<select
						value={sort}
						onChange={(event) => setSort(event.target.value)}
					>
						{!sortOptions.some(([value]) => value === sort) ? (
							<option value={sort}>{sort}</option>
						) : null}
						{sortOptions.map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
			</div>
			{taskFilterGroups.map((group) => (
				<details
					key={group.label}
					className="task-filter-group"
					open={
						group.fields.some(({ key }) => Boolean(params.get(key))) ||
						undefined
					}
				>
					<summary className="task-filter-summary">{group.label}</summary>
					{group.label === "Time ranges" ? (
						<p className="muted">
							Use a timezone, for example 2026-09-22T12:00:00Z. Lower bounds are
							inclusive; upper bounds are exclusive.
						</p>
					) : null}
					{group.label === "Resources and revisions" ? (
						<p className="muted">
							Revisions require a class ID. Relation type and ID must be
							supplied together.
						</p>
					) : null}
					<div className="form-grid">
						{group.fields.map((field) => {
							const value = draft[field.key] ?? "";
							const update = (next: string) =>
								setDraft((current) => ({ ...current, [field.key]: next }));
							if (field.type === "list")
								return (
									<fieldset key={field.key} className="task-filter-choices">
										<legend>{field.label}</legend>
										{field.options?.map((option) => (
											<label key={option} className="task-filter-choice">
												<input
													type="checkbox"
													className="task-filter-checkbox"
													checked={value.split(",").includes(option)}
													onChange={(event) => {
														const selected = new Set(
															value.split(",").filter(Boolean),
														);
														if (event.target.checked) selected.add(option);
														else selected.delete(option);
														update([...selected].join(","));
													}}
												/>
												{taskValueLabel(option)}
											</label>
										))}
									</fieldset>
								);
							const options =
								field.type === "boolean" ? ["true", "false"] : field.options;
							return (
								<div key={field.key} className="control-field">
									<label htmlFor={`task-filter-${field.key}`}>
										{field.label}
									</label>
									{options ? (
										<select
											id={`task-filter-${field.key}`}
											value={value}
											onChange={(event) => update(event.target.value)}
										>
											<option value="">Any</option>
											{value && !options.includes(value) ? (
												<option value={value}>{value} (invalid)</option>
											) : null}
											{options.map((option) => (
												<option key={option} value={option}>
													{field.type === "boolean"
														? option === "true"
															? "Yes"
															: "No"
														: taskValueLabel(option)}
												</option>
											))}
										</select>
									) : (
										<input
											id={`task-filter-${field.key}`}
											type={field.type === "number" ? "number" : "text"}
											min={field.minimum ?? 1}
											step={1}
											value={value}
											onChange={(event) => update(event.target.value)}
											placeholder={
												field.type === "time"
													? "YYYY-MM-DDTHH:mm:ssZ"
													: undefined
											}
										/>
									)}
									{field.key === "class_id" || field.key === "collection_id" ? (
										<ResourcePicker
											kind={field.key === "class_id" ? "class" : "collection"}
											label={
												field.key === "class_id"
													? "Find class"
													: "Find collection"
											}
											value={
												/^\d+$/.test(value) && Number(value) > 0 ? value : ""
											}
											onChange={update}
										/>
									) : null}
								</div>
							);
						})}
					</div>
				</details>
			))}
			{errors.length ? (
				<div className="error-banner" role="alert">
					<ul>
						{errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				</div>
			) : null}
			<div className="action-row">
				<button type="submit">Apply task filters</button>
				<button
					type="button"
					className="ghost"
					onClick={() => {
						setDraft({});
						setScope("mine");
						setSort(defaultTaskSort);
						setErrors([]);
						onApply(taskSearchParams({}, "mine", defaultTaskSort, limit));
					}}
				>
					Clear task filters
				</button>
			</div>
		</form>
	);
}
