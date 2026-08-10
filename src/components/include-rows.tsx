"use client";

import { useMemo, useState } from "react";
import { ClassDirectoryLookup } from "@/components/class-directory-lookup";
import { fetchClassDirectory } from "@/lib/api/resource-directory";
import {
	DEFAULT_INCLUDE_MAX_DEPTH,
	INCLUDE_DIRECTIONS,
	INCLUDE_SORTS,
	MAX_INCLUDE_ALIASES,
	MAX_INCLUDE_MAX_DEPTH,
	type IncludeBuilderRow,
} from "@/lib/report-include";
import type {
	ReportIncludeRelatedDirection,
	ReportIncludeRelatedSort,
} from "@/lib/api/reporting";
import type { HubuumClassExpanded } from "@/lib/api/generated/models";
import {
	directoryLookupStatus,
	useDirectorySearch,
} from "@/lib/use-directory-search";

type IncludeRowsProps = {
	rows: IncludeBuilderRow[];
	classOptions: { id: number; name: string }[];
	onAdd: () => void;
	onUpdate: (id: string, patch: Partial<IncludeBuilderRow>) => void;
	onRemove: (id: string) => void;
	error?: string;
	disabled?: boolean;
	minimumDepthByClassId?: ReadonlyMap<number, number>;
};

type RelatedClassFieldProps = {
	classOptions: { id: number; name: string }[];
	disabled: boolean;
	minimumDepthByClassId?: ReadonlyMap<number, number>;
	onChange: (value: string) => void;
	prefix: string;
	value: string;
};

function RelatedClassField({
	classOptions,
	disabled,
	minimumDepthByClassId,
	onChange,
	prefix,
	value,
}: RelatedClassFieldProps) {
	const [selectedDirectoryClass, setSelectedDirectoryClass] =
		useState<HubuumClassExpanded | null>(null);
	const directory = useDirectorySearch({
		queryKey: ["include-related-class-directory"],
		queryFn: fetchClassDirectory,
	});
	const allowedClassIds = useMemo(
		() =>
			minimumDepthByClassId ? new Set(minimumDepthByClassId.keys()) : null,
		[minimumDepthByClassId],
	);
	const directoryClasses = useMemo(
		() =>
			(directory.query.data?.items ?? []).filter(
				(classItem) => !allowedClassIds || allowedClassIds.has(classItem.id),
			),
		[allowedClassIds, directory.query.data?.items],
	);
	const parsedClassId = Number.parseInt(value, 10);
	const selectedClassName =
		classOptions.find((classItem) => classItem.id === parsedClassId)?.name ??
		directoryClasses.find((classItem) => classItem.id === parsedClassId)
			?.name ??
		(selectedDirectoryClass?.id === parsedClassId
			? selectedDirectoryClass.name
			: null);

	return (
		<div className="control-field">
			<label htmlFor={`${prefix}-class`}>Related class</label>
			<div className="directory-id-lookup-control">
				<input
					id={`${prefix}-class`}
					type="number"
					min={1}
					value={value}
					onChange={(event) => {
						onChange(event.target.value);
						directory.setSearch(event.target.value);
						setSelectedDirectoryClass(null);
					}}
					placeholder="Class ID"
					disabled={disabled}
				/>
				<ClassDirectoryLookup
					classes={directoryClasses}
					disabled={disabled}
					helperText={directoryLookupStatus({
						count: directoryClasses.length,
						isError: directory.query.isError,
						isLoading: directory.query.isLoading,
						isPartial: Boolean(directory.query.data?.isPartial),
						isReady: directory.isReady,
						minimumLength: directory.minimumLength,
						resourcePlural: "classes",
						resourceSingular: "class",
						scope: allowedClassIds
							? "reachable from the selected class"
							: undefined,
						term: directory.term,
					})}
					idPrefix={`${prefix}-class-directory`}
					onChange={directory.setSearch}
					onSelect={(classItem) => {
						onChange(String(classItem.id));
						setSelectedDirectoryClass(classItem);
					}}
					value={directory.search}
				/>
			</div>
			{selectedClassName ? (
				<small className="field-note">
					Selected: {selectedClassName} (#{parsedClassId})
				</small>
			) : null}
		</div>
	);
}

export function IncludeRows({
	rows,
	classOptions,
	onAdd,
	onUpdate,
	onRemove,
	error,
	disabled = false,
	minimumDepthByClassId,
}: IncludeRowsProps) {
	return (
		<div className="query-builder-card control-field--wide">
			<div className="panel-header">
				<div className="stack action-card-header">
					<h4>Related includes</h4>
					<p className="muted">
						Hydrate related objects under item.related.&lt;alias&gt; (up to{" "}
						{MAX_INCLUDE_ALIASES}). Each alias is a list.
					</p>
				</div>
				<div className="action-row">
					<button
						type="button"
						className="ghost"
						onClick={onAdd}
						disabled={disabled || rows.length >= MAX_INCLUDE_ALIASES}
					>
						Add include
					</button>
				</div>
			</div>

			{error ? (
				<div className="field-error" role="alert">
					{error}
				</div>
			) : null}

			{rows.length ? (
				<div className="include-builder-list">
					{rows.map((row, index) => {
						const prefix = `include-${row.id}`;
						const alias = row.alias.trim();
						const parsedClassId = /^[1-9]\d*$/.test(row.classId.trim())
							? Number.parseInt(row.classId, 10)
							: null;
						const minimumDepth =
							parsedClassId == null
								? DEFAULT_INCLUDE_MAX_DEPTH
								: (minimumDepthByClassId?.get(parsedClassId) ??
									DEFAULT_INCLUDE_MAX_DEPTH);
						return (
							<article key={row.id} className="include-builder-card">
								<div className="include-builder-card-header">
									<div className="stack action-card-header">
										<strong>{alias || `Related include ${index + 1}`}</strong>
										<code>item.related.{alias || "alias"}</code>
									</div>
									<button
										type="button"
										className="ghost compact-button"
										onClick={() => onRemove(row.id)}
										disabled={disabled}
									>
										Remove
									</button>
								</div>
								<div className="include-builder-fields">
									<label className="control-field" htmlFor={`${prefix}-alias`}>
										<span>Alias</span>
										<input
											id={`${prefix}-alias`}
											value={row.alias}
											onChange={(event) =>
												onUpdate(row.id, { alias: event.target.value })
											}
											placeholder="rooms"
											disabled={disabled}
										/>
									</label>
									<RelatedClassField
										classOptions={classOptions}
										disabled={disabled}
										minimumDepthByClassId={minimumDepthByClassId}
										onChange={(classId) => onUpdate(row.id, { classId })}
										prefix={prefix}
										value={row.classId}
									/>
									<label
										className="control-field"
										htmlFor={`${prefix}-direction`}
									>
										<span>Direction</span>
										<select
											id={`${prefix}-direction`}
											value={row.direction}
											onChange={(event) =>
												onUpdate(row.id, {
													direction: event.target
														.value as ReportIncludeRelatedDirection,
												})
											}
											disabled={disabled}
										>
											{INCLUDE_DIRECTIONS.map((direction) => (
												<option key={direction} value={direction}>
													{direction}
												</option>
											))}
										</select>
									</label>
									<label className="control-field" htmlFor={`${prefix}-sort`}>
										<span>Sort related items</span>
										<select
											id={`${prefix}-sort`}
											value={row.sort}
											onChange={(event) =>
												onUpdate(row.id, {
													sort: event.target.value as ReportIncludeRelatedSort,
												})
											}
											disabled={disabled}
										>
											{INCLUDE_SORTS.map((sort) => (
												<option key={sort} value={sort}>
													{sort}
												</option>
											))}
										</select>
									</label>
									<label className="control-field" htmlFor={`${prefix}-limit`}>
										<span>Maximum items</span>
										<input
											id={`${prefix}-limit`}
											type="number"
											min={1}
											max={50}
											value={row.limit}
											onChange={(event) =>
												onUpdate(row.id, { limit: event.target.value })
											}
											placeholder="1–50"
											disabled={disabled}
										/>
									</label>
									<label className="control-field" htmlFor={`${prefix}-depth`}>
										<span>Maximum path depth</span>
										<input
											id={`${prefix}-depth`}
											type="number"
											min={minimumDepth}
											max={MAX_INCLUDE_MAX_DEPTH}
											value={row.maxDepth}
											onChange={(event) =>
												onUpdate(row.id, { maxDepth: event.target.value })
											}
											placeholder={
												minimumDepth > DEFAULT_INCLUDE_MAX_DEPTH
													? `At least ${minimumDepth}`
													: `Default: ${DEFAULT_INCLUDE_MAX_DEPTH}`
											}
											disabled={disabled}
										/>
										{minimumDepth > DEFAULT_INCLUDE_MAX_DEPTH ? (
											<small className="field-note">
												This class is {minimumDepth} relations away, so the
												maximum path depth must be at least {minimumDepth}.
											</small>
										) : null}
									</label>
								</div>
							</article>
						);
					})}
				</div>
			) : (
				<div className="empty-state">
					No related includes. Add one to hydrate item.related.&lt;alias&gt;.
				</div>
			)}
		</div>
	);
}
