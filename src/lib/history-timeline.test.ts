import { describe, expect, it } from "vitest";
import type { HistoryResponseHistoryMarker } from "@/lib/api/generated/models";
import { historyVersionId, mergeHistoryMarkers } from "@/lib/history-timeline";

describe("history timeline identity and ordering", () => {
	it("keeps sub-millisecond ordering, timestamp ties and tombstones distinct", () => {
		const marker = (
			history_id: number,
			valid_from: string,
			op = "U",
		): HistoryResponseHistoryMarker => ({
			history_id,
			valid_from,
			op,
			id: 12,
			collection_id: 4,
			name: "object",
			revision: 2,
			provenance: { actor: {} },
		});
		const records = [
			marker(7, "2026-10-01T00:00:00.000002Z"),
			marker(9, "2026-10-01T00:00:00.000001Z"),
			marker(8, "2026-10-01T02:00:00.000002+02:00", "D"),
		];
		expect(
			mergeHistoryMarkers([...records, records[0]]).map(
				(record) => record.history_id,
			),
		).toEqual([8, 7, 9]);
	});
	it.each([null, "", "0", "-1", "1.1", "1e3", " 2", "9007199254740992"])(
		"rejects an invalid version ID %s",
		(value) => {
			expect(historyVersionId(value)).toBeUndefined();
		},
	);
	it("accepts a positive exact version ID", () =>
		expect(historyVersionId("123")).toBe(123));
});
