"use client";

import {
	INCLUDE_DIRECTIONS,
	INCLUDE_SORTS,
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
};

export function IncludeRows({
	rows,
	classOptions,
	onAdd,
	onUpdate,
	onRemove,
}: IncludeRowsProps) {
	return (
		<div className="query-builder-card control-field--wide">
			<div className="panel-header">
				<div className="stack action-card-header">
					<h4>Related includes</h4>
					<p className="muted">
						Hydrate related objects under item.related.&lt;alias&gt; (up to 8).
						Each alias is a list.
					</p>
				</div>
				<div className="action-row">
					<button
						type="button"
						className="ghost"
						onClick={onAdd}
						disabled={rows.length >= 8}
					>
						Add include
					</button>
				</div>
			</div>

			{rows.length ? (
				<div className="stack">
					{rows.map((row) => (
						<div key={row.id} className="query-row">
							<input
								value={row.alias}
								onChange={(event) => onUpdate(row.id, { alias: event.target.value })}
								placeholder="alias (e.g. rooms)"
							/>
							{classOptions.length > 0 ? (
								<select
									value={row.classId}
									onChange={(event) => onUpdate(row.id, { classId: event.target.value })}
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
									type="number"
									min={1}
									value={row.classId}
									onChange={(event) => onUpdate(row.id, { classId: event.target.value })}
									placeholder="class ID"
								/>
							)}
							<select
								value={row.direction}
								onChange={(event) =>
									onUpdate(row.id, {
										direction: event.target.value as ReportIncludeRelatedDirection,
									})
								}
							>
								{INCLUDE_DIRECTIONS.map((direction) => (
									<option key={direction} value={direction}>
										{direction}
									</option>
								))}
							</select>
							<select
								value={row.sort}
								onChange={(event) =>
									onUpdate(row.id, {
										sort: event.target.value as ReportIncludeRelatedSort,
									})
								}
							>
								{INCLUDE_SORTS.map((sort) => (
									<option key={sort} value={sort}>
										{sort}
									</option>
								))}
							</select>
							<input
								type="number"
								min={1}
								max={50}
								value={row.limit}
								onChange={(event) => onUpdate(row.id, { limit: event.target.value })}
								placeholder="limit 1..50"
							/>
							<input
								type="number"
								min={1}
								max={10}
								value={row.maxDepth}
								onChange={(event) => onUpdate(row.id, { maxDepth: event.target.value })}
								placeholder="depth 1..10"
							/>
							<button type="button" className="ghost" onClick={() => onRemove(row.id)}>
								Remove
							</button>
						</div>
					))}
				</div>
			) : (
				<div className="empty-state">
					No related includes. Add one to hydrate item.related.&lt;alias&gt;.
				</div>
			)}
		</div>
	);
}
