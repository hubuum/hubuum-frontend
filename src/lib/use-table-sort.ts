import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

type SortDirection = "asc" | "desc";

type SortState = {
	column: string | null;
	direction: SortDirection;
};

export function useTableSort() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const sortState: SortState = useMemo(() => {
		const sortParam = searchParams.get("sort");
		if (!sortParam) {
			return { column: null, direction: "asc" };
		}

		if (sortParam.startsWith("-")) {
			return { column: sortParam.slice(1), direction: "desc" };
		}

		return { column: sortParam, direction: "asc" };
	}, [searchParams]);

	const setSort = useCallback(
		(column: string) => {
			const params = new URLSearchParams(searchParams.toString());

			// Toggle direction if clicking the same column
			if (sortState.column === column) {
				if (sortState.direction === "asc") {
					params.set("sort", `-${column}`);
				} else {
					// Remove sort to go back to default
					params.delete("sort");
				}
			} else {
				// New column, sort ascending
				params.set("sort", column);
			}

			// Reset to first page when changing sort
			params.delete("cursor");

			router.push(`${pathname}?${params.toString()}`);
		},
		[pathname, router, searchParams, sortState],
	);

	const getSortParam = useCallback((): string | undefined => {
		const sortParam = searchParams.get("sort");
		return sortParam ?? undefined;
	}, [searchParams]);

	return {
		sortState,
		setSort,
		getSortParam,
	};
}
