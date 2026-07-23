import { describe, expect, it } from "vitest";

import {
	buildObjectDataPatchPlan,
	buildObjectDataReplacePatch,
	buildWholeObjectDataReplacePatch,
	toObjectDataJsonPointer,
} from "@/lib/api/object-data-patch";

describe("object data JSON Patch", () => {
	it("encodes property and array paths as RFC 6901 pointers", () => {
		expect(toObjectDataJsonPointer(["network", "a/b", "~meta", 2])).toBe(
			"/network/a~1b/~0meta/2",
		);
	});

	it("builds a compare-and-set replacement for a focused field", () => {
		expect(buildObjectDataReplacePatch(["version"], 4, 5)).toEqual([
			{ op: "test", path: "/version", value: 4 },
			{ op: "replace", path: "/version", value: 5 },
		]);
	});

	it("uses the empty pointer for a guarded whole-document replacement", () => {
		expect(buildWholeObjectDataReplacePatch({ a: 1 }, { a: 2 })).toEqual([
			{ op: "test", path: "", value: { a: 1 } },
			{ op: "replace", path: "", value: { a: 2 } },
		]);
	});

	it("builds a deterministic guarded patch for nested object changes", () => {
		const current = {
			legacy: true,
			network: {
				interfaces: [{ name: "eth0" }],
				mtu: 1500,
			},
		};
		const next = {
			network: {
				dhcp: true,
				interfaces: [{ name: "wan0" }],
				mtu: 9000,
			},
		};

		const plan = buildObjectDataPatchPlan(current, next);

		expect(plan.mode).toBe("granular");
		expect(plan.patch).toEqual([
			{ op: "test", path: "/legacy", value: true },
			{
				op: "test",
				path: "/network/interfaces",
				value: [{ name: "eth0" }],
			},
			{ op: "test", path: "/network/mtu", value: 1500 },
			{
				op: "test",
				path: "/network",
				value: { interfaces: [{ name: "eth0" }], mtu: 1500 },
			},
			{ op: "remove", path: "/legacy" },
			{
				op: "replace",
				path: "/network/interfaces",
				value: [{ name: "wan0" }],
			},
			{ op: "replace", path: "/network/mtu", value: 9000 },
			{ op: "add", path: "/network/dhcp", value: true },
		]);
		expect(plan.changes.map((change) => change.operation)).toEqual([
			"remove",
			"replace",
			"replace",
			"add",
		]);
	});

	it("escapes added object keys and ignores object key order", () => {
		expect(
			buildObjectDataPatchPlan(
				{ first: 1, second: 2 },
				{ second: 2, first: 1 },
			),
		).toEqual({ patch: [], changes: [], mode: "granular" });
		expect(buildObjectDataPatchPlan({}, { "a/b~c": 1 }).patch).toEqual([
			{ op: "test", path: "", value: {} },
			{ op: "add", path: "/a~1b~0c", value: 1 },
		]);
	});

	it("falls back when the granular patch exceeds the server operation limit", () => {
		const current = Object.fromEntries(
			Array.from({ length: 501 }, (_, index) => [`field_${index}`, index]),
		);
		const next = Object.fromEntries(
			Array.from({ length: 501 }, (_, index) => [`field_${index}`, index + 1]),
		);
		const plan = buildObjectDataPatchPlan(current, next);

		expect(plan.mode).toBe("whole-document");
		expect(plan.patch).toEqual(buildWholeObjectDataReplacePatch(current, next));
		expect(plan.changes).toHaveLength(501);
	});
});
