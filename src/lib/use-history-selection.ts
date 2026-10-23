"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryRecord } from "@/lib/api/events";

export function useHistorySelection() {
	const search = useSearchParams();
	const pathname = usePathname();
	const selectionUrl = `${pathname}?${search.toString()}`;
	const [scrollPreview, setScrollPreview] = useState<{
		url: string;
		record: HistoryRecord;
	} | null>(null);
	const scrollCommit = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Back/Forward and explicit navigation must cancel an uncommitted scroll.
	// biome-ignore lint/correctness/useExhaustiveDependencies: URL changes cancel the pending scroll commit.
	useEffect(() => {
		setScrollPreview(null);
		return () => {
			if (scrollCommit.current !== null) clearTimeout(scrollCommit.current);
		};
	}, [selectionUrl]);
	const updateUrl = useCallback(
		(values: Record<string, string | null>, replace = false) => {
			const params = new URLSearchParams(window.location.search);
			// Pinning or changing the comparison also commits the visible scroll preview.
			if (scrollPreview?.url === `${pathname}?${params}`) {
				params.set("at", scrollPreview.record.valid_from);
				params.set("version", String(scrollPreview.record.history_id));
			}
			for (const [key, value] of Object.entries(values)) {
				if (value === null) params.delete(key);
				else params.set(key, value);
			}
			if (scrollCommit.current !== null) {
				clearTimeout(scrollCommit.current);
				scrollCommit.current = null;
			}
			if (
				params.toString() ===
				new URLSearchParams(window.location.search).toString()
			)
				return;
			window.history[replace ? "replaceState" : "pushState"](
				null,
				"",
				`${pathname}?${params}`,
			);
		},
		[pathname, scrollPreview],
	);
	const selectVersion = useCallback(
		(record: HistoryRecord, scrolling = false) => {
			if (scrollCommit.current !== null) clearTimeout(scrollCommit.current);
			if (scrolling) {
				// Keep the snapshot responsive without writing history on every frame.
				setScrollPreview({ url: selectionUrl, record });
				scrollCommit.current = setTimeout(() => {
					updateUrl({
						at: record.valid_from,
						version: String(record.history_id),
					});
					scrollCommit.current = null;
				}, 250);
			} else {
				setScrollPreview(null);
				updateUrl({
					at: record.valid_from,
					version: String(record.history_id),
				});
			}
		},
		[updateUrl, selectionUrl],
	);
	return {
		preview:
			scrollPreview?.url === selectionUrl ? scrollPreview.record : undefined,
		updateUrl,
		selectVersion,
	};
}
