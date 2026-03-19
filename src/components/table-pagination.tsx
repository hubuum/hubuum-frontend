"use client";

type TablePaginationProps = {
	hasNextPage: boolean;
	hasPrevPage: boolean;
	onNextPage: () => void;
	onPrevPage: () => void;
	onFirstPage: () => void;
	currentCount: number;
	limit: number;
};

export function TablePagination({
	hasNextPage,
	hasPrevPage,
	onNextPage,
	onPrevPage,
	onFirstPage,
	currentCount,
	limit,
}: TablePaginationProps) {
	if (!hasNextPage && !hasPrevPage) {
		return null;
	}

	return (
		<div className="table-pagination">
			<div className="table-pagination-info">
				Showing {currentCount} of {currentCount}{" "}
				{hasNextPage ? "(more available)" : ""}
			</div>
			<div className="table-pagination-controls">
				{hasPrevPage ? (
					<>
						<button type="button" className="ghost" onClick={onFirstPage}>
							First
						</button>
						<button type="button" className="ghost" onClick={onPrevPage}>
							Previous
						</button>
					</>
				) : null}
				{hasNextPage ? (
					<button type="button" className="ghost" onClick={onNextPage}>
						Next
					</button>
				) : null}
			</div>
		</div>
	);
}
