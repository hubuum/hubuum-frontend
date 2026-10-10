"use client";

import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { Fragment, type ReactNode, useState } from "react";
import { ObjectAggregateCount } from "@/components/object-aggregate-count";
import type { ObjectAggregateRow } from "@/lib/api/generated/models";
import {
	fetchAllObjectAggregates,
	fetchObjectAggregates,
	type ObjectAggregateRequest,
} from "@/lib/api/object-aggregates";
import {
	formatObjectAggregateDimension,
	formatObjectAggregateMeasure,
	formatObjectAggregateMeasureLabel,
	getObjectAggregatePathKey,
	indexObjectAggregateChildren,
} from "@/lib/object-grouping";

type ObjectAggregateTreeProps = {
	request: Omit<ObjectAggregateRequest, "cursor" | "includeTotal">;
	fieldLabels: readonly string[];
	measureLabels: ReadonlyMap<string, string>;
	collectionNames: ReadonlyMap<number, string>;
};

export function ObjectAggregateTree({
	request,
	fieldLabels,
	measureLabels,
	collectionNames,
}: ObjectAggregateTreeProps) {
	const [expanded, setExpanded] = useState(new Map<string, number>());
	const [visibleChildren, setVisibleChildren] = useState<
		Record<string, number>
	>({});
	const [progress, setProgress] = useState<Record<number, number>>({});
	const [visibleRoots, setVisibleRoots] = useState(request.limit);
	const naturalSort =
		request.sort === "dimensions.asc" || request.sort === "dimensions.desc";
	const rootRequest = { ...request, groupBy: request.groupBy.slice(0, 1) };
	const roots = useInfiniteQuery({
		queryKey: ["object-aggregates", request.classId, "tree-roots", rootRequest],
		queryFn: async ({ pageParam, signal }) => {
			if (!naturalSort) {
				return fetchObjectAggregates(
					{ ...rootRequest, cursor: pageParam },
					signal,
				);
			}
			const rows = await fetchAllObjectAggregates(
				rootRequest,
				signal,
				(count) => setProgress((current) => ({ ...current, 0: count })),
			);
			return {
				rows,
				nextCursor: null,
				prevCursor: null,
				totalCount: rows.length,
				pageLimit: request.limit,
			};
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const levels = useQueries({
		queries: request.groupBy.slice(1).map((_, index) => {
			const depth = index + 1;
			const levelRequest = {
				...request,
				groupBy: request.groupBy.slice(0, depth + 1),
			};
			return {
				queryKey: [
					"object-aggregates",
					request.classId,
					"tree-level",
					levelRequest,
				],
				queryFn: ({ signal }: { signal: AbortSignal }) =>
					fetchAllObjectAggregates(levelRequest, signal, (count) =>
						setProgress((current) => ({ ...current, [depth]: count })),
					),
				enabled: [...expanded.values()].includes(depth),
				retry: false,
			};
		}),
	});
	const childrenByLevel = levels.map((level) =>
		indexObjectAggregateChildren(level.data ?? []),
	);
	const columnCount = 2 + (request.measures?.length ?? 0);

	function toggleGroup(key: string, depth: number) {
		setExpanded((current) => {
			const next = new Map(current);
			if (next.has(key)) next.delete(key);
			else next.set(key, depth);
			return next;
		});
	}

	function renderRows(
		rows: readonly ObjectAggregateRow[],
		depth: number,
	): ReactNode {
		return rows.map((row) => {
			const key = getObjectAggregatePathKey(row.dimensions);
			const dimension = row.dimensions[depth];
			const label = dimension
				? formatObjectAggregateDimension(dimension, collectionNames)
				: "—";
			const expandable = depth + 1 < request.groupBy.length;
			const isExpanded = expanded.has(key);
			const childQuery = levels[depth];
			const children = childrenByLevel[depth]?.get(key) ?? [];
			const visibleCount = visibleChildren[key] ?? request.limit;
			return (
				<Fragment key={key}>
					<tr>
						<td>
							<div
								className="object-aggregate-tree-label"
								style={{ paddingInlineStart: `${depth * 1.5}rem` }}
							>
								{expandable ? (
									<button
										type="button"
										className="ghost"
										aria-expanded={isExpanded}
										aria-label={`${isExpanded ? "Collapse" : "Expand"} ${fieldLabels[depth]}: ${label}`}
										onClick={() => toggleGroup(key, depth + 1)}
									>
										{label}
										<span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
									</button>
								) : (
									<span>{label}</span>
								)}
								<small className="muted object-aggregate-tree-field">
									{fieldLabels[depth]}
								</small>
							</div>
						</td>
						<td className="object-group-count">
							<ObjectAggregateCount
								request={request}
								row={row}
								fieldLabels={fieldLabels}
								collectionNames={collectionNames}
							/>
						</td>
						{request.measures?.map((measure, index) => {
							const result = row.measures?.[index];
							return (
								<td
									className="object-group-measure"
									key={`${measure.operation}:${measure.field}`}
								>
									{result ? (
										<>
											{formatObjectAggregateMeasure(result)}
											<small>
												{result.value_count} used · {result.skipped_count}{" "}
												skipped
											</small>
										</>
									) : (
										"—"
									)}
								</td>
							);
						})}
					</tr>
					{isExpanded && childQuery ? (
						<>
							{childQuery.data
								? renderRows(children.slice(0, visibleCount), depth + 1)
								: null}
							{childQuery.isError ? (
								<tr>
									<td colSpan={columnCount}>
										<div className="error-banner" role="alert">
											Could not load subgroups for {label}.{" "}
											{childQuery.error.message}{" "}
											<button
												type="button"
												onClick={() => void childQuery.refetch()}
											>
												Retry subgroups for {label}
											</button>
										</div>
									</td>
								</tr>
							) : childQuery.isFetching ? (
								<tr>
									<td colSpan={columnCount}>
										<div role="status">
											Loading subgroups for {label}… {progress[depth + 1] ?? 0}{" "}
											aggregate groups loaded.
										</div>
									</td>
								</tr>
							) : children.length === 0 ? (
								<tr>
									<td colSpan={columnCount} className="muted">
										No subgroups for {label}. The data may have changed; refresh
										to update totals.
									</td>
								</tr>
							) : null}
							{children.length > visibleCount ? (
								<tr>
									<td colSpan={columnCount}>
										<button
											type="button"
											className="ghost"
											onClick={() =>
												setVisibleChildren((current) => ({
													...current,
													[key]: visibleCount + request.limit,
												}))
											}
										>
											Show more subgroups for {label} (
											{Math.min(visibleCount, children.length)} of{" "}
											{children.length})
										</button>
									</td>
								</tr>
							) : null}
						</>
					) : null}
				</Fragment>
			);
		});
	}

	const allRootRows = roots.data?.pages.flatMap((page) => page.rows) ?? [];
	const rootRows = naturalSort
		? allRootRows.slice(0, visibleRoots)
		: allRootRows;
	return (
		<section
			className="object-table-scroll object-grouped-table-scroll"
			aria-label="Object aggregates"
		>
			<p className="table-scroll-hint">
				Scroll horizontally to see all counts and measures.
			</p>
			{roots.isPending ? (
				<p role="status">
					Loading object aggregates…
					{naturalSort ? ` ${progress[0] ?? 0} aggregate groups loaded.` : ""}
				</p>
			) : null}
			{roots.isError ? (
				<div className="error-banner" role="alert">
					Failed to load object aggregates. {roots.error.message}{" "}
					<button type="button" onClick={() => void roots.refetch()}>
						Retry aggregates
					</button>
				</div>
			) : null}
			{roots.data && rootRows.length === 0 ? (
				<p>No aggregate groups match this query.</p>
			) : null}
			{rootRows.length > 0 ? (
				<table className="object-grouped-table object-aggregate-tree-table">
					<caption className="sr-only">
						Objects grouped by {fieldLabels.join(" then ")}, with parent
						subtotals
					</caption>
					<thead>
						<tr>
							<th scope="col">
								<span className="sr-only">Group</span>
							</th>
							<th scope="col">Count</th>
							{request.measures?.map((measure) => (
								<th scope="col" key={`${measure.operation}:${measure.field}`}>
									{formatObjectAggregateMeasureLabel(
										measure.operation,
										measureLabels.get(measure.field) ?? measure.field,
									)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>{renderRows(rootRows, 0)}</tbody>
				</table>
			) : null}
			{roots.hasNextPage ||
			(naturalSort && visibleRoots < allRootRows.length) ? (
				<button
					type="button"
					className="ghost"
					disabled={roots.isFetching}
					onClick={() => {
						if (naturalSort)
							setVisibleRoots((current) => current + request.limit);
						else void roots.fetchNextPage();
					}}
				>
					{roots.isFetchingNextPage ? "Loading groups…" : "Load more groups"}
				</button>
			) : null}
			{roots.data ? (
				<p className="muted">
					{rootRows.length} top-level groups shown
					{roots.data.pages[0]?.totalCount != null
						? ` of ${roots.data.pages[0]?.totalCount}`
						: ""}
					.
				</p>
			) : null}
		</section>
	);
}
