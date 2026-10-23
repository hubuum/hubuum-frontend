"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchResourceHistoryAsOf } from "@/lib/api/events";
import {
	fetchHistoryEntry,
	fetchHistoryTimeline,
} from "@/lib/api/history-navigation";
import type { HistoryResponseHistoryMarker } from "@/lib/api/generated/models";
import { mergeHistoryMarkers } from "@/lib/history-timeline";
import { type HistoryScope, versionContains } from "@/lib/resource-history";

export function useHistoryTimeline(
	scope: HistoryScope,
	version: number | undefined,
	at: string,
	valid: boolean,
	preview?: HistoryResponseHistoryMarker,
) {
	const selectionKey = `${version ?? ""}:${at}`;
	const [window, setWindow] = useState({ version, at });
	const [lastSelection, setLastSelection] = useState(selectionKey);
	const anchor = useQuery({
		queryKey: ["history-browser", scope, "entry", window.version],
		queryFn: ({ signal }) =>
			fetchHistoryEntry(scope, window.version as number, signal),
		enabled: valid && window.version !== undefined,
		retry: false,
	});
	const queryWindow =
		window.version !== undefined
			? { anchor: window.version }
			: window.at
				? { at: window.at }
				: {};
	const older = useInfiniteQuery({
		queryKey: ["history-browser", scope, "markers", queryWindow, "older"],
		initialPageParam: "",
		queryFn: ({ pageParam, signal }) =>
			fetchHistoryTimeline(
				scope,
				{ ...queryWindow, direction: "older", cursor: pageParam || undefined },
				signal,
			),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: valid,
		retry: false,
	});
	const newer = useInfiniteQuery({
		queryKey: ["history-browser", scope, "markers", queryWindow, "newer"],
		initialPageParam: "",
		queryFn: ({ pageParam, signal }) =>
			fetchHistoryTimeline(
				scope,
				{ ...queryWindow, direction: "newer", cursor: pageParam || undefined },
				signal,
			),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: valid && Boolean(window.version || window.at),
		retry: false,
	});
	const records = mergeHistoryMarkers<HistoryResponseHistoryMarker>([
		...(older.data?.pages.flatMap((page) => page.items) ?? []),
		...(newer.data?.pages.flatMap((page) => page.items) ?? []),
		...(anchor.data && !anchor.isError ? [anchor.data] : []),
	]);
	// Keep the current window while travelling within it. Bookmarks, Back/Forward,
	// and date jumps outside it seek directly instead of scanning from the newest page.
	if (selectionKey !== lastSelection) {
		setLastSelection(selectionKey);
		if (
			version === undefined ||
			!records.some((record) => record.history_id === version)
		)
			setWindow({ version, at });
	}
	const asOf = useQuery({
		queryKey: ["history-browser", scope, "as-of", at],
		queryFn: async () => {
			const record = await fetchResourceHistoryAsOf(scope, at);
			if (
				!versionContains(record, at) ||
				record.id !==
					(scope.type === "class" ? scope.classId : scope.objectId) ||
				!("collection_id" in record) ||
				(scope.type === "object"
					? !("hubuum_class_id" in record) ||
						record.hubuum_class_id !== scope.classId
					: !("validate_schema" in record))
			)
				throw new Error("No active snapshot is available at this time.");
			return record;
		},
		enabled: valid && Boolean(at) && version === undefined && !preview,
		retry: false,
	});
	const activeId =
		preview?.history_id ??
		version ??
		(at ? asOf.data?.history_id : records[0]?.history_id);
	const entry = useQuery({
		queryKey: ["history-browser", scope, "entry", activeId],
		queryFn: ({ signal }) =>
			fetchHistoryEntry(scope, activeId as number, signal),
		enabled:
			valid &&
			activeId !== undefined &&
			!(version === undefined && at && !preview),
		retry: false,
	});
	const snapshot =
		version === undefined && at && !preview
			? asOf.isError
				? undefined
				: asOf.data
			: entry.isError
				? undefined
				: entry.data;
	const mismatch = Boolean(
		snapshot &&
			at &&
			!preview &&
			snapshot.valid_from !== at &&
			!versionContains(snapshot, at),
	);
	const selected =
		valid && !mismatch
			? (snapshot ??
				preview ??
				records.find((record) => record.history_id === activeId))
			: undefined;
	return {
		records,
		selected,
		snapshot: mismatch ? undefined : snapshot,
		mismatch,
		older,
		newer,
		loading: older.isLoading || entry.isFetching || asOf.isFetching,
		error: version === undefined && at && !preview ? asOf.error : entry.error,
		retrySnapshot: () => {
			void (version === undefined && at ? asOf.refetch() : entry.refetch());
		},
	};
}
