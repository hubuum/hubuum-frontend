import { describe, expect, it } from "vitest";

import type { TaskRecord } from "@/lib/api/tasking";
import {
	countUnread,
	diffNewlyTerminal,
	filterMine,
	toastForTransition,
} from "@/lib/task-notifications";

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
	return {
		id: 1,
		kind: "import",
		status: "running",
		created_at: "2026-06-21T10:00:00.000Z",
		links: {} as TaskRecord["links"],
		progress: {} as TaskRecord["progress"],
		...overrides,
	} as TaskRecord;
}

const seen = Date.parse("2026-06-21T12:00:00.000Z");

describe("filterMine", () => {
	it("keeps only tasks submitted by me", () => {
		const tasks = [
			makeTask({ id: 1, submitted_by: 7 }),
			makeTask({ id: 2, submitted_by: 99 }),
			makeTask({ id: 3, submitted_by: 7 }),
		];
		expect(filterMine(tasks, 7).map((t) => t.id)).toEqual([1, 3]);
	});
});

describe("diffNewlyTerminal", () => {
	it("returns [] on the first poll (prev null)", () => {
		const next = [makeTask({ id: 1, status: "succeeded" })];
		expect(diffNewlyTerminal(null, next)).toEqual([]);
	});

	it("detects non-terminal -> terminal", () => {
		const prev = [makeTask({ id: 1, status: "running" })];
		const next = [makeTask({ id: 1, status: "succeeded" })];
		expect(diffNewlyTerminal(prev, next).map((t) => t.id)).toEqual([1]);
	});

	it("ignores terminal -> terminal", () => {
		const prev = [makeTask({ id: 1, status: "succeeded" })];
		const next = [makeTask({ id: 1, status: "succeeded" })];
		expect(diffNewlyTerminal(prev, next)).toEqual([]);
	});

	it("ignores non-terminal -> non-terminal", () => {
		const prev = [makeTask({ id: 1, status: "queued" })];
		const next = [makeTask({ id: 1, status: "running" })];
		expect(diffNewlyTerminal(prev, next)).toEqual([]);
	});

	it("ignores tasks absent from prev (avoids backlog toasts)", () => {
		const prev = [makeTask({ id: 1, status: "running" })];
		const next = [
			makeTask({ id: 1, status: "running" }),
			makeTask({ id: 2, status: "succeeded" }),
		];
		expect(diffNewlyTerminal(prev, next)).toEqual([]);
	});
});

describe("countUnread", () => {
	it("counts terminal tasks finished strictly after lastSeenAt", () => {
		const tasks = [
			makeTask({ id: 1, status: "succeeded", finished_at: "2026-06-21T13:00:00.000Z" }),
			makeTask({ id: 2, status: "failed", finished_at: "2026-06-21T11:00:00.000Z" }),
			makeTask({ id: 3, status: "running", finished_at: null }),
		];
		const result = countUnread(tasks, seen, false);
		expect(result.unreadCount).toBe(1);
		expect(result.hasUnreadFailure).toBe(false);
	});

	it("treats the boundary as exclusive (equal to lastSeenAt is not unread)", () => {
		const tasks = [
			makeTask({ id: 1, status: "succeeded", finished_at: "2026-06-21T12:00:00.000Z" }),
		];
		expect(countUnread(tasks, seen, false).unreadCount).toBe(0);
	});

	it("flags unread failures", () => {
		const tasks = [
			makeTask({ id: 1, status: "partially_succeeded", finished_at: "2026-06-21T13:00:00.000Z" }),
		];
		const result = countUnread(tasks, seen, false);
		expect(result.unreadCount).toBe(1);
		expect(result.hasUnreadFailure).toBe(true);
	});

	it("falls back to started_at/created_at when finished_at is missing", () => {
		const tasks = [
			makeTask({ id: 1, status: "succeeded", finished_at: null, started_at: "2026-06-21T13:00:00.000Z" }),
			makeTask({ id: 2, status: "cancelled", finished_at: null, started_at: null, created_at: "2026-06-21T13:30:00.000Z" }),
		];
		expect(countUnread(tasks, seen, false).unreadCount).toBe(2);
	});

	it("sets isSaturated to pageFull regardless of contents", () => {
		expect(countUnread([], seen, true).isSaturated).toBe(true);
		expect(countUnread([], seen, false).isSaturated).toBe(false);
	});
});

describe("toastForTransition", () => {
	it("maps succeeded to a success toast", () => {
		const t = makeTask({ id: 42, kind: "import", status: "succeeded" });
		expect(toastForTransition(t)).toEqual({
			message: "Import #42 succeeded",
			type: "success",
		});
	});

	it("maps failed to an error toast", () => {
		const t = makeTask({ id: 41, kind: "report", status: "failed" });
		expect(toastForTransition(t)).toEqual({
			message: "Report #41 failed",
			type: "error",
		});
	});

	it("maps partially_succeeded to an info toast and includes summary", () => {
		const t = makeTask({ id: 9, kind: "import", status: "partially_succeeded", summary: "3 of 5 rows" });
		expect(toastForTransition(t)).toEqual({
			message: "Import #9 partially succeeded — 3 of 5 rows",
			type: "info",
		});
	});

	it("maps cancelled to an info toast", () => {
		const t = makeTask({ id: 5, kind: "export", status: "cancelled" });
		expect(toastForTransition(t)).toEqual({
			message: "Export #5 was cancelled",
			type: "info",
		});
	});

	it("labels remote calls as remote invocations", () => {
		const t = makeTask({ id: 17, kind: "remote_call", status: "succeeded" });
		expect(toastForTransition(t)).toEqual({
			message: "Remote invocation #17 succeeded",
			type: "success",
		});
	});
});
