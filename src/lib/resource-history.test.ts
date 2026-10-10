import { describe, expect, it } from "vitest";
import type { HistoryRecord } from "@/lib/api/events";
import {
	buildObjectRestore,
	compareSnapshots,
	historyInstant,
	resourceHistoryHref,
	restoreChoices,
	snapshotFields,
	versionContains,
} from "@/lib/resource-history";

const record: HistoryRecord = {
	id: 12,
	history_id: 91,
	revision: 2,
	hubuum_class_id: 3,
	collection_id: 4,
	name: "server",
	description: "",
	data: { os: "Debian" },
	op: "UPDATE",
	created_at: "2026-09-01T00:00:00Z",
	updated_at: "2026-09-24T08:42:13.830219Z",
	valid_from: "2026-09-24T08:42:13.830219Z",
	valid_to: "2026-09-24T08:42:13.830220Z",
	provenance: { actor: {} },
};

describe("history selection and comparison", () => {
	it("retains microseconds in URLs and half-open effective intervals", () => {
		expect(
			resourceHistoryHref(
				{ type: "object", classId: 3, objectId: 12 },
				record.valid_from,
				91,
			),
		).toContain("830219Z");
		expect(versionContains(record, record.valid_from)).toBe(true);
		expect(versionContains(record, record.valid_to ?? "")).toBe(false);
		expect(versionContains(record, "2026-09-24T08:42:13.830218Z")).toBe(false);
		expect(historyInstant("2026-09-24T10:42:13.830219+02:00")).toBe(
			historyInstant(record.valid_from),
		);
		expect(historyInstant("nonsense")).toBeNull();
		expect(historyInstant("2026-02-30T08:42:13Z")).toBeNull();
		expect(historyInstant("2026-02-28T24:00:00Z")).toBeNull();
		expect(historyInstant("2024-02-29T08:42:13Z")).not.toBeNull();
		expect(
			versionContains(
				{ ...record, op: "DELETE", valid_to: null },
				record.valid_from,
			),
		).toBe(false);
	});
	it("compares only resource state and distinguishes absent, null, and string values", () => {
		expect(snapshotFields(record)).not.toHaveProperty("history_id");
		expect(snapshotFields(record)).not.toHaveProperty("provenance");
		expect(
			compareSnapshots({ removed: null, x: "{}" }, { added: null, x: {} }),
		).toEqual([
			{ path: "/removed", kind: "removed", before: null, after: undefined },
			{ path: "/x", kind: "changed", before: "{}", after: {} },
			{ path: "/added", kind: "added", before: undefined, after: null },
		]);
	});
});

describe("object restoration", () => {
	const live = { network: { mtu: 9000, extra: true }, os: "new", list: [2, 1] };
	const old = {
		network: { mtu: 1500, nullable: null },
		os: "old",
		list: [1, 2],
	};
	it("restores a key while preserving unrelated data and guarding the reviewed document", () => {
		const plan = buildObjectRestore(live, old, ["/network/mtu"]);
		expect(plan.proposed).toEqual({
			...live,
			network: { mtu: 1500, extra: true },
		});
		expect(plan.patch).toEqual([
			{ op: "test", path: "", value: live },
			{ op: "replace", path: "", value: plan.proposed },
		]);
	});
	it("restores exact subtrees including removals and null additions", () => {
		expect(
			buildObjectRestore(live, old, ["/network", "/network/mtu"]).proposed,
		).toEqual({ ...live, network: old.network });
		expect(buildObjectRestore(live, old, ["/network/extra"]).proposed).toEqual({
			...live,
			network: { mtu: 9000 },
		});
		expect(
			buildObjectRestore(live, old, ["/network/nullable"]).proposed,
		).toEqual({ ...live, network: { ...live.network, nullable: null } });
	});
	it("restores arrays as units and whole scalar/empty documents", () => {
		expect(
			restoreChoices(live, old).some((choice) =>
				choice.path.startsWith("/list/"),
			),
		).toBe(false);
		expect(buildObjectRestore(live, old, ["/list"]).proposed).toEqual({
			...live,
			list: old.list,
		});
		expect(buildObjectRestore(live, {}, [""]).proposed).toEqual({});
		expect(buildObjectRestore(live, null, [""]).proposed).toBeNull();
		expect(buildObjectRestore(live, old, []).patch).toEqual([]);
		expect(() => buildObjectRestore(live, old, ["/list/0"])).toThrow(
			"selection",
		);
	});
	it("handles escaped pointers and prototype-named keys without mutating inputs", () => {
		const before = JSON.parse('{"a/b~c":1,"__proto__":{"old":true}}');
		const after = JSON.parse('{"a/b~c":2,"__proto__":{"restored":true}}');
		expect(
			buildObjectRestore(before, after, ["/a~1b~0c", "/__proto__"]).proposed,
		).toEqual(after);
		expect(before["a/b~c"]).toBe(1);
		expect(Object.prototype).not.toHaveProperty("restored");
	});
});
