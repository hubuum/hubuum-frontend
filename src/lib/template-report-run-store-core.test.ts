import { describe, expect, it } from "vitest";

import { InMemoryTemplateReportRunStore } from "@/lib/template-report-run-store-core";

describe("template report run store", () => {
	it("only deletes the expected task pointer", async () => {
		const store = new InMemoryTemplateReportRunStore();
		await store.setTaskId("report", 12);

		await store.deleteTaskId("report", 11);
		expect(await store.getTaskId("report")).toBe(12);

		await store.deleteTaskId("report", 12);
		expect(await store.getTaskId("report")).toBeNull();
	});

	it("acquires and releases locks by owner", async () => {
		const store = new InMemoryTemplateReportRunStore();

		expect(await store.tryAcquireLock("report", "owner-a", 30_000)).toBe(
			true,
		);
		expect(await store.tryAcquireLock("report", "owner-b", 30_000)).toBe(
			false,
		);
		await store.releaseLock("report", "owner-b");
		expect(await store.tryAcquireLock("report", "owner-b", 30_000)).toBe(
			false,
		);
		await store.releaseLock("report", "owner-a");
		expect(await store.tryAcquireLock("report", "owner-b", 30_000)).toBe(
			true,
		);
	});
});
