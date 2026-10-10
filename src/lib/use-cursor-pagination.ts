import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	type CursorTrail,
	extendCursorTrail,
	hasPreviousCursorInTrail,
	normalizeCursorPageLimit,
	parseCursorTrail,
	previousCursorFromTrail,
} from "@/lib/cursor-pagination";

type UseCursorPaginationOptions = {
	defaultLimit?: number;
	cursorKey?: string;
};

export function useCursorPagination({
	defaultLimit = 100,
	cursorKey = "cursor",
}: UseCursorPaginationOptions = {}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const cursor = searchParams.get(cursorKey) ?? undefined;
	const limit = normalizeCursorPageLimit(
		searchParams.get("limit"),
		defaultLimit,
	);
	const historyStorageKey = useMemo(() => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete(cursorKey);
		return `hubuum.cursor-trail:v1:${cursorKey === "cursor" ? "" : `${cursorKey}:`}${pathname}?${params.toString()}`;
	}, [cursorKey, pathname, searchParams]);
	const [cursorTrail, setCursorTrail] = useState<CursorTrail>([]);
	const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(
		null,
	);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const storedValue = window.sessionStorage.getItem(historyStorageKey);
		setCursorTrail(parseCursorTrail(storedValue));
		setHydratedStorageKey(historyStorageKey);
	}, [historyStorageKey]);

	useEffect(() => {
		if (
			typeof window === "undefined" ||
			hydratedStorageKey !== historyStorageKey
		) {
			return;
		}

		if (!cursorTrail.length) {
			window.sessionStorage.removeItem(historyStorageKey);
			return;
		}

		window.sessionStorage.setItem(
			historyStorageKey,
			JSON.stringify(cursorTrail),
		);
	}, [cursorTrail, historyStorageKey, hydratedStorageKey]);

	const activeCursorTrail =
		hydratedStorageKey === historyStorageKey ? cursorTrail : [];
	const hasPrevPage = hasPreviousCursorInTrail(activeCursorTrail, cursor);

	const goToNextPage = useCallback(
		(nextCursor: string) => {
			setCursorTrail((current) =>
				extendCursorTrail(current, cursor, nextCursor),
			);
			const params = new URLSearchParams(searchParams.toString());
			params.set(cursorKey, nextCursor);
			router.push(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[cursor, cursorKey, pathname, router, searchParams],
	);

	const goToPrevPage = useCallback(
		(prevCursor?: string) => {
			if (!hasPrevPage && !prevCursor) {
				return;
			}

			const targetCursor = previousCursorFromTrail(
				activeCursorTrail,
				cursor,
				prevCursor,
			);
			const params = new URLSearchParams(searchParams.toString());
			if (targetCursor) {
				params.set(cursorKey, targetCursor);
			} else {
				params.delete(cursorKey);
			}
			router.push(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[
			activeCursorTrail,
			cursor,
			cursorKey,
			hasPrevPage,
			pathname,
			router,
			searchParams,
		],
	);

	const goToFirstPage = useCallback(() => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete(cursorKey);
		router.push(`${pathname}?${params.toString()}`, { scroll: false });
	}, [cursorKey, pathname, router, searchParams]);

	const setLimit = useCallback(
		(newLimit: number) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set(
				"limit",
				String(normalizeCursorPageLimit(String(newLimit), defaultLimit)),
			);
			params.delete(cursorKey); // Reset to first page when changing limit
			router.push(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[cursorKey, defaultLimit, pathname, router, searchParams],
	);

	return {
		cursor,
		limit,
		hasPrevPage,
		goToNextPage,
		goToPrevPage,
		goToFirstPage,
		setLimit,
	};
}
