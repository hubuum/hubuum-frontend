"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { CreateModal } from "@/components/create-modal";
import { TablePagination } from "@/components/table-pagination";
import { fetchObjectsByClass } from "@/lib/api/class-objects";
import type { ObjectAggregateRow } from "@/lib/api/generated/models";
import type { ObjectAggregateRequest } from "@/lib/api/object-aggregates";
import {
	buildObjectAggregateObjectsHref,
	getObjectAggregateMemberFilters,
} from "@/lib/object-aggregate-filter";
import { formatObjectAggregateDimension } from "@/lib/object-grouping";

type ObjectAggregateCountProps = {
	request: Pick<ObjectAggregateRequest, "classId" | "filters" | "limit">;
	row: ObjectAggregateRow;
	fieldLabels: readonly string[];
	collectionNames: ReadonlyMap<number, string>;
};

function ObjectAggregateObjectsDialog({
	request,
	row,
	label,
	onClose,
}: Pick<ObjectAggregateCountProps, "request" | "row"> & {
	label: string;
	onClose: () => void;
}) {
	const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
	const cursor = cursors.at(-1);
	const members = useQuery({
		queryKey: [
			"objects",
			request.classId,
			"aggregate-members",
			request,
			row.dimensions,
			cursor,
		],
		queryFn: ({ signal }) =>
			fetchObjectsByClass(
				request.classId,
				request.limit,
				cursor,
				"id.asc",
				request.filters,
				signal,
			),
		retry: false,
	});
	const objects = members.data?.objects ?? [];
	const total = members.data?.totalCount ?? row.object_count;
	return (
		<CreateModal
			open
			title={
				<span className="object-aggregate-dialog-heading">
					<span>
						{total} matching object{total === 1 ? "" : "s"}
					</span>
					<Link
						className="ghost icon-button"
						href={buildObjectAggregateObjectsHref(
							request.classId,
							request.filters ?? [],
							request.limit,
						)}
						aria-label="Open in object table"
						title="Open in object table"
						onNavigate={onClose}
						prefetch={false}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M3 3h18v18H3zm2 2v4h14V5zm0 6v3h4v-3zm6 0v3h8v-3zm-6 5v3h4v-3zm6 0v3h8v-3z"
								fill="currentColor"
							/>
						</svg>
					</Link>
					<span className="object-aggregate-dialog-label">{label}</span>
				</span>
			}
			onClose={onClose}
		>
			<div className="stack">
				{members.isFetching ? (
					<p role="status">Loading matching objects…</p>
				) : null}
				{members.isError ? (
					<div className="error-banner" role="alert">
						{members.error.message}{" "}
						<button type="button" onClick={() => void members.refetch()}>
							Retry matching objects
						</button>
					</div>
				) : null}
				{members.data ? (
					<>
						{objects.length ? (
							<div className="object-table-scroll">
								<table>
									<caption className="sr-only">
										Objects matching {label}
									</caption>
									<thead>
										<tr>
											<th scope="col">Name</th>
											<th scope="col">Description</th>
										</tr>
									</thead>
									<tbody>
										{objects.map((object) => (
											<tr key={object.id}>
												<td>
													<Link
														href={`/objects/${object.hubuum_class_id}/${object.id}`}
													>
														{object.name}
													</Link>
												</td>
												<td>{object.description}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : null}
						<TablePagination
							hasNextPage={Boolean(members.data.nextCursor)}
							hasPrevPage={cursors.length > 1}
							onNextPage={() => {
								if (members.data.nextCursor)
									setCursors([...cursors, members.data.nextCursor]);
							}}
							onPrevPage={() => setCursors(cursors.slice(0, -1))}
							onFirstPage={() => setCursors([undefined])}
							currentCount={objects.length}
							totalCount={members.data.totalCount}
							busy={members.isFetching}
						/>
					</>
				) : null}
			</div>
		</CreateModal>
	);
}

export function ObjectAggregateCount({
	request,
	row,
	fieldLabels,
	collectionNames,
}: ObjectAggregateCountProps) {
	const [open, setOpen] = useState(false);
	const unavailableReasonId = useId();
	let filters = request.filters ?? [];
	let unavailableReason: string | undefined;
	try {
		filters = getObjectAggregateMemberFilters(row.dimensions, filters);
	} catch (error) {
		unavailableReason =
			error instanceof Error ? error.message : "Unable to filter this group.";
	}
	const memberRequest = {
		classId: request.classId,
		filters,
		limit: request.limit,
	};
	const label =
		row.dimensions
			.map(
				(dimension, index) =>
					`${fieldLabels[index] ?? dimension.field}: ${formatObjectAggregateDimension(dimension, collectionNames)}`,
			)
			.join(" → ") || "All matching objects";
	return (
		<>
			<button
				type="button"
				className="object-aggregate-count"
				aria-haspopup="dialog"
				aria-label={`View ${row.object_count} objects for ${label}`}
				aria-describedby={unavailableReason ? unavailableReasonId : undefined}
				disabled={Boolean(unavailableReason)}
				onClick={() => setOpen(true)}
			>
				{row.object_count}
			</button>
			{unavailableReason ? (
				<small
					id={unavailableReasonId}
					className="object-aggregate-unavailable"
				>
					{unavailableReason}
				</small>
			) : null}
			{open && !unavailableReason
				? createPortal(
						<ObjectAggregateObjectsDialog
							request={memberRequest}
							row={row}
							label={label}
							onClose={() => setOpen(false)}
						/>,
						document.body,
					)
				: null}
		</>
	);
}
