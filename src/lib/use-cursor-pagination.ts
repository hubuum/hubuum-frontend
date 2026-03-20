import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type UseCursorPaginationOptions = {
	defaultLimit?: number;
};

const FIRST_PAGE_CURSOR = "__first_page__";

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
	const historyStorageKey = useMemo(() => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("cursor");
		return `hubuum.cursor-history:${pathname}?${params.toString()}`;
	}, [pathname, searchParams]);
	const [cursorHistory, setCursorHistory] = useState<string[]>([]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const storedValue = window.sessionStorage.getItem(historyStorageKey);
		if (!storedValue) {
			setCursorHistory([]);
			return;
		}

		try {
			const parsed = JSON.parse(storedValue) as unknown;
			setCursorHistory(
				Array.isArray(parsed)
					? parsed.filter((item): item is string => typeof item === "string")
					: [],
			);
		} catch {
			setCursorHistory([]);
		}
	}, [historyStorageKey]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (!cursorHistory.length) {
			window.sessionStorage.removeItem(historyStorageKey);
			return;
		}

		window.sessionStorage.setItem(
			historyStorageKey,
			JSON.stringify(cursorHistory),
		);
	}, [cursorHistory, historyStorageKey]);

	const goToNextPage = useCallback(
		(nextCursor: string) => {
			setCursorHistory((current) => [
				...current,
				cursor ?? FIRST_PAGE_CURSOR,
			]);
			const params = new URLSearchParams(searchParams.toString());
			params.set("cursor", nextCursor);
			router.push(`${pathname}?${params.toString()}`);
		},
		[cursor, pathname, router, searchParams],
	);

	const goToPrevPage = useCallback(
		(prevCursor?: string) => {
			const previousEntry =
				cursorHistory.length > 0
					? cursorHistory[cursorHistory.length - 1]
					: undefined;
			const targetCursor =
				previousEntry === undefined
					? prevCursor
					: previousEntry === FIRST_PAGE_CURSOR
						? undefined
						: previousEntry;

			if (targetCursor === undefined && !prevCursor && cursorHistory.length === 0) {
				return;
			}

			if (previousEntry !== undefined) {
				setCursorHistory((current) => current.slice(0, -1));
			}

			const params = new URLSearchParams(searchParams.toString());
			if (targetCursor) {
				params.set("cursor", targetCursor);
			} else {
				params.delete("cursor");
			}
			router.push(`${pathname}?${params.toString()}`);
		},
		[cursorHistory, pathname, router, searchParams],
	);

	const goToFirstPage = useCallback(() => {
		setCursorHistory([]);
		const params = new URLSearchParams(searchParams.toString());
		params.delete("cursor");
		router.push(`${pathname}?${params.toString()}`);
	}, [pathname, router, searchParams]);

	const setLimit = useCallback(
		(newLimit: number) => {
			setCursorHistory([]);
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
		hasPrevPage: cursorHistory.length > 0,
		goToNextPage,
		goToPrevPage,
		goToFirstPage,
		setLimit,
	};
}
