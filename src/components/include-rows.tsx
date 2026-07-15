"use client";

import {
	INCLUDE_DIRECTIONS,
	INCLUDE_SORTS,
	MAX_INCLUDE_ALIASES,
	type IncludeBuilderRow,
} from "@/lib/report-include";
import type {
	ReportIncludeRelatedDirection,
	ReportIncludeRelatedSort,
} from "@/lib/api/reporting";

type IncludeRowsProps = {
	rows: IncludeBuilderRow[];
	classOptions: { id: number; name: string }[];
	onAdd: () => void;
	onUpdate: (id: string, patch: Partial<IncludeBuilderRow>) => void;
	onRemove: (id: string) => void;
	error?: string;
	disabled?: boolean;
};

export function IncludeRows({
	rows,
	classOptions,
	onAdd,
	onUpdate,
	onRemove,
	error,
	disabled = false,
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
									<div className="control-field">
										<label htmlFor={`${prefix}-class`}>Related class</label>
										{classOptions.length > 0 ? (
											<select
												id={`${prefix}-class`}
												value={row.classId}
												onChange={(event) =>
													onUpdate(row.id, { classId: event.target.value })
												}
												disabled={disabled}
											>
												<option value="">Select class</option>
												{classOptions.map((classItem) => (
													<option key={classItem.id} value={classItem.id}>
														{classItem.name} (#{classItem.id})
													</option>
												))}
											</select>
										) : (
											<input
												id={`${prefix}-class`}
												type="number"
												min={1}
												value={row.classId}
												onChange={(event) =>
													onUpdate(row.id, { classId: event.target.value })
												}
												placeholder="Class ID"
												disabled={disabled}
											/>
										)}
									</div>
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
											min={1}
											max={10}
											value={row.maxDepth}
											onChange={(event) =>
												onUpdate(row.id, { maxDepth: event.target.value })
											}
											placeholder="1–10"
											disabled={disabled}
										/>
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
