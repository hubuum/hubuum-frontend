import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

type UseCursorPaginationOptions = {
	defaultLimit?: number;
};

export function useCursorPagination({
	defaultLimit = 100,
}: UseCursorPaginationOptions = {}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const cursor = searchParams.get("cursor") ?? undefined;
	const limit = Number.parseInt(
		searchParams.get("limit") ?? String(defaultLimit),
		10,
	);

	const goToNextPage = useCallback(
		(nextCursor: string) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("cursor", nextCursor);
			router.push(`${pathname}?${params.toString()}`);
		},
		[pathname, router, searchParams],
	);

	const goToPrevPage = useCallback(
		(prevCursor: string) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("cursor", prevCursor);
			router.push(`${pathname}?${params.toString()}`);
		},
		[pathname, router, searchParams],
	);

	const goToFirstPage = useCallback(() => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("cursor");
		router.push(`${pathname}?${params.toString()}`);
	}, [pathname, router, searchParams]);

	const setLimit = useCallback(
		(newLimit: number) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("limit", String(newLimit));
			params.delete("cursor"); // Reset to first page when changing limit
			router.push(`${pathname}?${params.toString()}`);
		},
		[pathname, router, searchParams],
	);

	return {
		cursor,
		limit,
		goToNextPage,
		goToPrevPage,
		goToFirstPage,
		setLimit,
	};
}
