"use client";

import { useEffect, useId } from "react";

import {
	markPaginationActive,
	registerPaginationShortcut,
} from "@/lib/pagination-shortcuts";

type TablePaginationProps = {
	hasNextPage: boolean;
	hasPrevPage: boolean;
	onNextPage: () => void;
	onPrevPage: () => void;
	onFirstPage: () => void;
	currentCount: number;
};

export function TablePagination({
	hasNextPage,
	hasPrevPage,
	onNextPage,
	onPrevPage,
	onFirstPage,
	currentCount,
}: TablePaginationProps) {
	const paginationId = useId();

	useEffect(() => {
		return registerPaginationShortcut(paginationId, {
			canGoNext: () => hasNextPage,
			canGoPrev: () => hasPrevPage,
			canGoFirst: () => hasPrevPage,
			onNextPage,
			onPrevPage,
			onFirstPage,
		});
	}, [
		paginationId,
		hasNextPage,
		hasPrevPage,
		onNextPage,
		onPrevPage,
		onFirstPage,
	]);

	if (!hasNextPage && !hasPrevPage) {
		return null;
	}

	return (
		<div
			className="table-pagination"
			onFocusCapture={() => markPaginationActive(paginationId)}
			onPointerDownCapture={() => markPaginationActive(paginationId)}
		>
			<div className="table-pagination-info">
				<span>Showing {currentCount} of {currentCount}</span>
				{hasPrevPage ? (
					<button
						type="button"
						className="ghost table-pagination-action"
						onClick={() => {
							markPaginationActive(paginationId);
							onPrevPage();
						}}
					>
						Previous page
					</button>
				) : null}
				{hasNextPage ? (
					<button
						type="button"
						className="ghost table-pagination-action"
						onClick={() => {
							markPaginationActive(paginationId);
							onNextPage();
						}}
					>
						Next page
					</button>
				) : null}
			</div>
			<div className="table-pagination-controls">
				{hasPrevPage ? (
					<button type="button" className="ghost" onClick={onFirstPage}>
						First
					</button>
				) : null}
			</div>
		</div>
	);
}
