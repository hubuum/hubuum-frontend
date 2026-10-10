import type {
	EventRecord,
	HistoryRecord,
	ResourceEventScope,
} from "@/lib/api/events";
import {
	buildObjectDataPatchPlan,
	buildWholeObjectDataReplacePatch,
	toObjectDataJsonPointer,
} from "@/lib/api/object-data-patch";

export type HistoryScope = Exclude<ResourceEventScope, { type: "collection" }>;

export function resourceHref(scope: HistoryScope): string {
	return scope.type === "object"
		? `/objects/${scope.classId}/${scope.objectId}`
		: `/classes/${scope.classId}`;
}

export function resourceHistoryHref(
	scope: HistoryScope,
	at?: string,
	historyId?: number,
): string {
	const params = new URLSearchParams();
	if (at) params.set("at", at);
	if (historyId !== undefined) params.set("version", String(historyId));
	return `${resourceHref(scope)}/history${params.size ? `?${params}` : ""}`;
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function eventHistoryHref(
	event: EventRecord,
	scope?: HistoryScope,
): string | null {
	if (!event.entity_id) return null;
	if (
		scope &&
		scope.type === event.entity_type &&
		event.entity_id ===
			(scope.type === "object" ? scope.objectId : scope.classId)
	) {
		return resourceHistoryHref(scope, event.occurred_at);
	}
	if (event.entity_type === "class") {
		return resourceHistoryHref(
			{ type: "class", classId: event.entity_id },
			event.occurred_at,
		);
	}
	if (event.entity_type !== "object") return null;
	for (const state of [event.after, event.before]) {
		if (isJsonRecord(state) && typeof state.hubuum_class_id === "number") {
			return resourceHistoryHref(
				{
					type: "object",
					classId: state.hubuum_class_id,
					objectId: event.entity_id,
				},
				event.occurred_at,
			);
		}
	}
	return null;
}

export function isDeletedVersion(record: HistoryRecord): boolean {
	return /^(d|delete|deleted)$/i.test(record.op);
}

// Display formatting may use Date; selection and interval comparisons retain
// the server's sub-millisecond precision and original request string.
export function historyInstant(value: string): bigint | null {
	const match =
		/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
			value,
		);
	if (!match) return null;
	const [year, month, day, hour, minute, second] = match[1]
		.split(/[-T:]/i)
		.map(Number);
	const calendar = new Date(0);
	calendar.setUTCFullYear(year, month - 1, day);
	if (
		month < 1 ||
		month > 12 ||
		day < 1 ||
		calendar.getUTCMonth() !== month - 1 ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	)
		return null;
	const seconds = Date.parse(`${match[1]}${match[3]}`);
	if (!Number.isFinite(seconds)) return null;
	return BigInt(seconds) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}

export function versionContains(record: HistoryRecord, at: string): boolean {
	if (isDeletedVersion(record)) return false;
	const point = historyInstant(at);
	const start = historyInstant(record.valid_from);
	const end = record.valid_to ? historyInstant(record.valid_to) : null;
	return (
		point !== null &&
		start !== null &&
		point >= start &&
		(!record.valid_to || (end !== null && point < end))
	);
}

export function snapshotFields(record: HistoryRecord): Record<string, unknown> {
	if (!("collection_id" in record))
		throw new Error("Unsupported history resource.");
	const fields: Record<string, unknown> = {
		name: record.name,
		description: record.description,
		collection_id: record.collection_id,
	};
	if ("hubuum_class_id" in record) {
		fields.hubuum_class_id = record.hubuum_class_id;
		fields.data = record.data;
	} else if ("validate_schema" in record) {
		fields.validate_schema = record.validate_schema;
		if (Object.hasOwn(record, "json_schema"))
			fields.json_schema = record.json_schema;
	}
	return fields;
}

export type SnapshotChange = {
	path: string;
	kind: "added" | "removed" | "changed";
	before: unknown;
	after: unknown;
};

export function compareSnapshots(
	before: unknown,
	after: unknown,
): SnapshotChange[] {
	return buildObjectDataPatchPlan(before, after).changes.map((change) => ({
		path: change.path,
		kind:
			change.operation === "add"
				? "added"
				: change.operation === "remove"
					? "removed"
					: "changed",
		before: change.previousValue,
		after: change.nextValue,
	}));
}

export type RestoreChoice = {
	path: string;
	segments: string[];
};

export function restoreChoices(
	live: unknown,
	historical: unknown,
): RestoreChoice[] {
	const changes = compareSnapshots(live, historical);
	if (!changes.length) return [];
	const choices = new Map<string, RestoreChoice>([
		["", { path: "", segments: [] }],
	]);
	for (const change of changes) {
		if (!change.path) continue;
		const segments = change.path
			.slice(1)
			.split("/")
			.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
		for (let length = 1; length <= segments.length; length++) {
			const prefix = segments.slice(0, length);
			const path = toObjectDataJsonPointer(prefix);
			choices.set(path, { path, segments: prefix });
		}
	}
	return [...choices.values()];
}

export function buildObjectRestore(
	live: unknown,
	historical: unknown,
	selectedPaths: readonly string[],
) {
	const choices = restoreChoices(live, historical);
	const selected = new Set(selectedPaths);
	if (
		[...selected].some(
			(path) => !choices.some((choice) => choice.path === path),
		)
	) {
		throw new Error(
			"The restore selection is no longer available. Review it again.",
		);
	}
	function restore(
		before: unknown,
		after: unknown,
		segments: string[],
	): unknown {
		const path = toObjectDataJsonPointer(segments);
		if (selected.has(path)) return after;
		if (
			![...selected].some((selectedPath) => selectedPath.startsWith(`${path}/`))
		)
			return before;
		if (!isJsonRecord(before) || !isJsonRecord(after)) return before;
		const result = { ...before };
		for (const key of new Set([
			...Object.keys(before),
			...Object.keys(after),
		])) {
			const child = [...segments, key];
			const value = restore(
				Object.hasOwn(before, key) ? before[key] : undefined,
				Object.hasOwn(after, key) ? after[key] : undefined,
				child,
			);
			if (value === undefined) delete result[key];
			else
				Object.defineProperty(result, key, {
					value,
					enumerable: true,
					writable: true,
					configurable: true,
				});
		}
		return result;
	}
	const proposed = restore(live, historical, []);
	const changes = compareSnapshots(live, proposed);
	return {
		proposed,
		changes,
		// Guard the whole reviewed document, including concurrent additions in
		// selected subtrees. This remains safe on servers that omit an ETag.
		patch: changes.length
			? buildWholeObjectDataReplacePatch(live, proposed)
			: [],
	};
}
