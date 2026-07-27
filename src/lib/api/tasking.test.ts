import { describe, expect, it } from "vitest";

import {
	formatTaskElapsedTime,
	getTaskProgressPercent,
	getTaskStatusTone,
} from "@/lib/api/tasking";

describe("task presentation helpers", () => {
	it("maps task outcomes to shared status tones", () => {
		expect(getTaskStatusTone("succeeded")).toBe("success");
		expect(getTaskStatusTone("failed")).toBe("danger");
		expect(getTaskStatusTone("cancelled")).toBe("danger");
		expect(getTaskStatusTone("partially_succeeded")).toBe("accent");
		expect(getTaskStatusTone("running")).toBe("neutral");
		expect(getTaskStatusTone(null)).toBe("neutral");
	});

	it("calculates bounded progress and completes terminal tasks", () => {
		const progress = {
			failed_items: 0,
			processed_items: 3,
			success_items: 3,
			total_items: 4,
		};

		expect(getTaskProgressPercent({ progress, status: "running" })).toBe(75);
		expect(
			getTaskProgressPercent({
				progress: { ...progress, processed_items: 7 },
				status: "running",
			}),
		).toBe(100);
		expect(
			getTaskProgressPercent({
				progress: { ...progress, total_items: 0 },
				status: "running",
			}),
		).toBe(0);
		expect(getTaskProgressPercent({ progress, status: "failed" })).toBe(100);
		expect(getTaskProgressPercent(null)).toBe(0);
	});

	it("formats completed and active task elapsed times", () => {
		expect(
			formatTaskElapsedTime(
				{
					status: "succeeded",
					started_at: "2026-07-27T07:33:00.100Z",
					finished_at: "2026-07-27T07:33:00.850Z",
				},
				Date.parse("2026-07-27T08:00:00Z"),
			),
		).toBe("750 ms");
		expect(
			formatTaskElapsedTime(
				{
					status: "running",
					started_at: "2026-07-27T07:33:00Z",
					finished_at: null,
				},
				Date.parse("2026-07-27T07:35:05Z"),
			),
		).toBe("2m 5s");
		expect(
			formatTaskElapsedTime(
				{
					status: "succeeded",
					started_at: "2026-07-25T04:30:00Z",
					finished_at: "2026-07-27T07:35:05Z",
				},
				Date.parse("2026-07-27T08:00:00Z"),
			),
		).toBe("2d 3h 5m");
	});

	it("handles task elapsed times that cannot be calculated", () => {
		expect(
			formatTaskElapsedTime(
				{ status: "queued", started_at: null, finished_at: null },
				Date.parse("2026-07-27T08:00:00Z"),
			),
		).toBe("Not started");
		expect(
			formatTaskElapsedTime(
				{
					status: "succeeded",
					started_at: "2026-07-27T07:33:00Z",
					finished_at: null,
				},
				Date.parse("2026-07-27T08:00:00Z"),
			),
		).toBe("n/a");
		expect(
			formatTaskElapsedTime(
				{
					status: "failed",
					started_at: "not-a-date",
					finished_at: "2026-07-27T07:33:00Z",
				},
				Date.parse("2026-07-27T08:00:00Z"),
			),
		).toBe("n/a");
	});
});
