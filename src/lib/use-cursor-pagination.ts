import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	extendCursorTrail,
	hasPreviousCursorInTrail,
	normalizeCursorPageLimit,
	parseCursorTrail,
	previousCursorFromTrail,
	type CursorTrail,
} from "@/lib/cursor-pagination";

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
	const limit = normalizeCursorPageLimit(
		searchParams.get("limit"),
		defaultLimit,
	);
	const historyStorageKey = useMemo(() => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("cursor");
		return `hubuum.cursor-trail:v1:${pathname}?${params.toString()}`;
	}, [pathname, searchParams]);
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
			params.set("cursor", nextCursor);
			router.push(`${pathname}?${params.toString()}`);
		},
		[cursor, pathname, router, searchParams],
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
				params.set("cursor", targetCursor);
			} else {
				params.delete("cursor");
			}
			router.push(`${pathname}?${params.toString()}`);
		},
		[
			activeCursorTrail,
			cursor,
			hasPrevPage,
			pathname,
			router,
			searchParams,
		],
	);

	const goToFirstPage = useCallback(() => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("cursor");
		router.push(`${pathname}?${params.toString()}`);
	}, [pathname, router, searchParams]);

	const setLimit = useCallback(
		(newLimit: number) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set(
				"limit",
				String(normalizeCursorPageLimit(String(newLimit), defaultLimit)),
			);
			params.delete("cursor"); // Reset to first page when changing limit
			router.push(`${pathname}?${params.toString()}`);
		},
		[defaultLimit, pathname, router, searchParams],
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
