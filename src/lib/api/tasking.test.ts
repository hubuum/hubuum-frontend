import { afterEach, describe, expect, it, vi } from "vitest";

import {
	cancelTask,
	fetchTasks,
	formatTaskElapsedTime,
	getImportUnattemptedCount,
	getTaskProgressPercent,
	getTaskStatusTone,
	taskCancelReasonError,
} from "@/lib/api/tasking";

afterEach(() => vi.unstubAllGlobals());

describe("task discovery requests", () => {
	it("sends filters and cursor together without losing false values", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async () => new Response("[]", { headers: { "x-next-cursor": "next" } }),
		);
		vi.stubGlobal("fetch", fetch);
		await expect(
			fetchTasks({
				filters: {
					kind: "export,backup",
					output_state: "expired",
					cancel_requested: false,
					submitted_by: 7,
				},
				cursor: "page two",
				limit: 50,
			}),
		).resolves.toEqual({ tasks: [], nextCursor: "next" });
		const url = new URL(
			fetch.mock.calls[0][0] as string,
			"https://frontend.example",
		);
		expect(url.pathname).toBe("/_hubuum-bff/hubuum/api/v1/tasks");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			kind: "export,backup",
			output_state: "expired",
			cancel_requested: "false",
			submitted_by: "7",
			cursor: "page two",
			limit: "50",
			sort: "created_at.desc,id.desc",
			include_total: "false",
		});
	});
	it("surfaces server filter-combination and authorization errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response('{"message":"Filters conflict with task kinds"}', {
						status: 400,
					}),
			),
		);
		await expect(
			fetchTasks({ filters: { kind: "import", class_id: 1 } }),
		).rejects.toThrow("Filters conflict with task kinds");
	});
});

describe("task cancellation", () => {
	it.each([200, 202])(
		"accepts HTTP %s and preserves the authoritative task status",
		async (status) => {
			const task = {
				id: 7,
				status: status === 200 ? "cancelled" : "running",
				cancel_requested_at: "2026-09-15T12:00:00Z",
			};
			const fetch = vi.fn(
				async () => new Response(JSON.stringify(task), { status }),
			);
			vi.stubGlobal("fetch", fetch);
			await expect(
				cancelTask(7, { reason: "Wrong input", expected_status: "queued" }),
			).resolves.toEqual(task);
			expect(fetch).toHaveBeenCalledWith(
				"/_hubuum-bff/hubuum/api/v1/tasks/7/cancel",
				expect.objectContaining({
					method: "POST",
					credentials: "include",
					body: JSON.stringify({
						reason: "Wrong input",
						expected_status: "queued",
					}),
				}),
			);
		},
	);
	it("sends an empty object for unconditional cancellation without a reason", async () => {
		const fetch = vi.fn(async () => new Response('{"status":"succeeded"}'));
		vi.stubGlobal("fetch", fetch);
		await expect(cancelTask(7)).resolves.toEqual({ status: "succeeded" });
		expect(fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ body: "{}" }),
		);
	});
	it.each([400, 403, 404, 409, 503])(
		"preserves HTTP %s errors without retrying a cancellation",
		async (status) => {
			const fetch = vi.fn(
				async () =>
					new Response('{"message":"Cancellation refused"}', { status }),
			);
			vi.stubGlobal("fetch", fetch);
			await expect(cancelTask(7)).rejects.toThrow("Cancellation refused");
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);
	it("validates UTF-8 bytes and control characters before sending", async () => {
		expect(taskCancelReasonError("")).toBeNull();
		expect(taskCancelReasonError("ø".repeat(256))).toBeNull();
		expect(taskCancelReasonError("ø".repeat(257))).toContain("512 UTF-8 bytes");
		expect(taskCancelReasonError("😀".repeat(128))).toBeNull();
		for (const reason of [
			" ",
			"line\nbreak",
			"tab\tvalue",
			"control\u0085value",
		]) {
			expect(taskCancelReasonError(reason)).toContain("single-line");
		}
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(cancelTask(7, { reason: "ø".repeat(257) })).rejects.toThrow(
			"512 UTF-8 bytes",
		);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("reads the aggregate unattempted count without treating it as a failed item", () => {
		expect(
			getImportUnattemptedCount({
				outcome: "unattempted",
				details: { count: 23 },
			}),
		).toBe(23);
		expect(
			getImportUnattemptedCount({ outcome: "failed", details: { count: 23 } }),
		).toBeNull();
		for (const details of [
			null,
			{},
			{ count: "23" },
			{ count: -1 },
			{ count: 1.5 },
		]) {
			expect(
				getImportUnattemptedCount({ outcome: "unattempted", details }),
			).toBeNull();
		}
	});
});

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
