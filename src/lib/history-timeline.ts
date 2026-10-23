import type { HistoryRecord } from "@/lib/api/events";
import type { HistoryResponseHistoryMarker } from "@/lib/api/generated/models";
import { historyInstant } from "@/lib/resource-history";

export type HistoryEntry = HistoryRecord | HistoryResponseHistoryMarker;

export function mergeHistoryMarkers<T extends HistoryEntry>(entries: T[]): T[] {
	return [
		...new Map(entries.map((entry) => [entry.history_id, entry])).values(),
	].sort((a, b) => {
		const left = historyInstant(a.valid_from);
		const right = historyInstant(b.valid_from);
		if (left === null || right === null)
			throw new Error("Invalid history timestamp.");
		return left === right ? b.history_id - a.history_id : left > right ? -1 : 1;
	});
}

export function historyVersionId(value: string | null): number | undefined {
	if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
	const id = Number(value);
	return Number.isSafeInteger(id) ? id : undefined;
}
