import { isTerminalTaskStatus, type TaskRecord } from "@/lib/api/tasking";

export type ToastType = "success" | "error" | "info";

export type NotificationToast = {
	message: string;
	type: ToastType;
};

export type UnreadSummary = {
	unreadCount: number;
	hasUnreadFailure: boolean;
	isSaturated: boolean;
};

export function filterMine<T extends { submitted_by?: number | null }>(
	tasks: readonly T[],
	myId: number,
): T[] {
	return tasks.filter((task) => task.submitted_by === myId);
}

export function diffNewlyTerminal(
	prev: readonly TaskRecord[] | null,
	next: readonly TaskRecord[],
): TaskRecord[] {
	if (!prev) {
		return [];
	}

	const prevById = new Map(prev.map((task) => [task.id, task]));

	return next.filter((task) => {
		if (!isTerminalTaskStatus(task.status)) {
			return false;
		}
		const previous = prevById.get(task.id);
		return previous != null && !isTerminalTaskStatus(previous.status);
	});
}

function effectiveCompletionMs(task: TaskRecord): number {
	const stamp = task.finished_at ?? task.started_at ?? task.created_at ?? null;
	return stamp ? Date.parse(stamp) : Number.NaN;
}

export function countUnread(
	myTasks: readonly TaskRecord[],
	lastSeenAt: number,
	pageFull: boolean,
): UnreadSummary {
	let unreadCount = 0;
	let hasUnreadFailure = false;

	for (const task of myTasks) {
		if (!isTerminalTaskStatus(task.status)) {
			continue;
		}
		const completionMs = effectiveCompletionMs(task);
		if (Number.isNaN(completionMs) || completionMs <= lastSeenAt) {
			continue;
		}
		unreadCount += 1;
		if (task.status === "failed" || task.status === "partially_succeeded") {
			hasUnreadFailure = true;
		}
	}

	return { unreadCount, hasUnreadFailure, isSaturated: pageFull };
}

const TASK_KIND_LABELS: Record<string, string> = {
	import: "Import",
	report: "Report",
	export: "Export",
	reindex: "Reindex",
	remote_call: "Remote invocation",
};

function taskKindLabel(kind: string): string {
	return (
		TASK_KIND_LABELS[kind] ??
		`${(kind[0] ?? "").toUpperCase()}${kind.slice(1)}`
	);
}

const STATUS_PHRASES: Record<string, { phrase: string; type: ToastType }> = {
	succeeded: { phrase: "succeeded", type: "success" },
	failed: { phrase: "failed", type: "error" },
	partially_succeeded: { phrase: "partially succeeded", type: "info" },
	cancelled: { phrase: "was cancelled", type: "info" },
};

export function toastForTransition(task: TaskRecord): NotificationToast {
	const status = STATUS_PHRASES[task.status] ?? {
		phrase: String(task.status),
		type: "info" as ToastType,
	};
	const base = `${taskKindLabel(task.kind)} #${task.id} ${status.phrase}`;
	const message = task.summary ? `${base} — ${task.summary}` : base;
	return { message, type: status.type };
}
