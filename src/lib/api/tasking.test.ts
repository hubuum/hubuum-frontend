import { describe, expect, it } from "vitest";

import {
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
});
