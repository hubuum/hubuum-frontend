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
	totalCount?: number | null;
	busy?: boolean;
};

export function TablePagination({
	hasNextPage,
	hasPrevPage,
	onNextPage,
	onPrevPage,
	onFirstPage,
	currentCount,
	totalCount = null,
	busy = false,
}: TablePaginationProps) {
	const paginationId = useId();

	useEffect(() => {
		return registerPaginationShortcut(paginationId, {
			canGoNext: () => hasNextPage && !busy,
			canGoPrev: () => hasPrevPage && !busy,
			canGoFirst: () => hasPrevPage && !busy,
			onNextPage,
			onPrevPage,
			onFirstPage,
		});
	}, [
		paginationId,
		busy,
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
			aria-busy={busy}
			onFocusCapture={() => markPaginationActive(paginationId)}
			onPointerDownCapture={() => markPaginationActive(paginationId)}
		>
			<div className="table-pagination-info">
				<span>
					Showing {currentCount}
					{totalCount !== null ? ` of ${totalCount}` : " loaded"}
				</span>
				{hasPrevPage ? (
					<button
						type="button"
						className="ghost table-pagination-action"
						disabled={busy}
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
						disabled={busy}
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
					<button
						type="button"
						className="ghost"
						onClick={onFirstPage}
						disabled={busy}
					>
						First
					</button>
				) : null}
			</div>
		</div>
	);
}
