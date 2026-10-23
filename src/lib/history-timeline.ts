import type { HistoryRecord } from "@/lib/api/events";
import type { HistoryResponseHistoryMarker } from "@/lib/api/generated/models";
import { historyInstant } from "@/lib/resource-history";

export type HistoryEntry = HistoryRecord | HistoryResponseHistoryMarker;

export function mergeHistoryMarkers<T extends HistoryEntry>(entries: T[]): T[] {
	return [
		...new Map(entries.map((entry) => [entry.history_id, entry])).values(),
	]
		.map((entry) => {
			const instant = historyInstant(entry.valid_from);
			if (instant === null) throw new Error("Invalid history timestamp.");
			return { entry, instant };
		})
		.sort((a, b) =>
			a.instant === b.instant
				? b.entry.history_id - a.entry.history_id
				: a.instant > b.instant
					? -1
					: 1,
		)
		.map(({ entry }) => entry);
}

export function historyVersionId(value: string | null): number | undefined {
	if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
	const id = Number(value);
	return Number.isSafeInteger(id) ? id : undefined;
}
