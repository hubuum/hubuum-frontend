"use client";

export function TableQueryStatus({
	query,
}: {
	query: {
		isFetching: boolean;
		isError: boolean;
		refetch: () => Promise<unknown>;
	};
}) {
	if (query.isError)
		return (
			<div className="error-banner" role="alert">
				Could not update results.{" "}
				<button
					type="button"
					className="ghost"
					onClick={() => void query.refetch()}
					disabled={query.isFetching}
				>
					Retry
				</button>
			</div>
		);
	return query.isFetching ? (
		<p className="muted" role="status">
			Updating results…
		</p>
	) : null;
}
