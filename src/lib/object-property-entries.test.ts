import { describe, expect, it } from "vitest";

import { flattenObjectPropertyEntries } from "@/lib/object-property-entries";

describe("flattenObjectPropertyEntries", () => {
	it("flattens nested records and arrays in deterministic key order", () => {
		const result = flattenObjectPropertyEntries({
			zebra: true,
			hardware: {
				memory: { total: 580 },
				cpu: [{ model: "Xeon", cores: 48 }],
			},
			alpha: null,
		});

		expect(result.entries.map(({ path, value }) => ({ path, value }))).toEqual([
			{ path: "alpha", value: "null" },
			{ path: "hardware.cpu[0].cores", value: "48" },
			{ path: "hardware.cpu[0].model", value: "Xeon" },
			{ path: "hardware.memory.total", value: "580" },
			{ path: "zebra", value: "true" },
		]);
		expect(result.truncated).toBe(false);
	});

	it("escapes path punctuation in object keys without obscuring array indices", () => {
		const result = flattenObjectPropertyEntries({
			"network.name": { "path\\key": "host" },
			"rack[slot]": [{ "port.name": "xe-0/0/0" }],
			"": "unnamed",
		});

		expect(result.entries.map((entry) => entry.path)).toEqual([
			`[""]`,
			"network\\.name.path\\\\key",
			"rack\\[slot\\][0].port\\.name",
		]);
		expect(new Set(result.entries.map((entry) => entry.id)).size).toBe(3);
	});

	it("formats primitive values for direct display", () => {
		const result = flattenObjectPropertyEntries({
			blank: "",
			count: -0,
			enabled: false,
			lineBreak: "one\ntwo",
			missing: null,
			spaces: "   ",
		});

		expect(
			Object.fromEntries(
				result.entries.map((entry) => [entry.path, entry.value]),
			),
		).toEqual({
			blank: `""`,
			count: "-0",
			enabled: "false",
			lineBreak: `"one\\ntwo"`,
			missing: "null",
			spaces: `"   "`,
		});
	});

	it("emits explicit summaries for empty containers", () => {
		const result = flattenObjectPropertyEntries({
			emptyArray: [],
			emptyObject: {},
		});

		expect(result.entries).toMatchObject([
			{
				path: "emptyArray",
				label: "emptyArray",
				value: "Empty array",
				kind: "empty-array",
			},
			{
				path: "emptyObject",
				label: "emptyObject",
				value: "Empty object",
				kind: "empty-object",
			},
		]);
		expect(result.truncated).toBe(false);
	});

	it("summarizes branches beyond the depth cap and reports truncation", () => {
		const result = flattenObjectPropertyEntries(
			{
				array: [{ hidden: true }, { hidden: false }],
				object: { hidden: 1, second: 2 },
				visible: "yes",
			},
			{ maxDepth: 1 },
		);

		expect(result.entries).toMatchObject([
			{ path: "array", value: "2 items", kind: "array-summary" },
			{ path: "object", value: "2 fields", kind: "object-summary" },
			{ path: "visible", value: "yes", kind: "primitive" },
		]);
		expect(result.truncated).toBe(true);
	});

	it("stops at the entry cap while preserving stable traversal order", () => {
		const capped = flattenObjectPropertyEntries(
			{ delta: 4, alpha: 1, charlie: 3, bravo: 2 },
			{ maxEntries: 2 },
		);
		const exact = flattenObjectPropertyEntries(
			{ bravo: 2, alpha: 1 },
			{ maxEntries: 2 },
		);

		expect(capped.entries.map((entry) => entry.path)).toEqual([
			"alpha",
			"bravo",
		]);
		expect(capped.truncated).toBe(true);
		expect(exact.entries.map((entry) => entry.path)).toEqual([
			"alpha",
			"bravo",
		]);
		expect(exact.truncated).toBe(false);
	});

	it("handles root values and a zero entry cap", () => {
		expect(flattenObjectPropertyEntries("root").entries).toMatchObject([
			{ id: "[]", path: "$", label: "$", value: "root" },
		]);
		expect(flattenObjectPropertyEntries([], { maxDepth: 0 })).toEqual({
			entries: [expect.objectContaining({ path: "$", value: "Empty array" })],
			truncated: false,
		});
		expect(
			flattenObjectPropertyEntries({ value: 1 }, { maxEntries: 0 }),
		).toEqual({
			entries: [],
			truncated: true,
		});
	});

	it("does not mutate input objects, arrays, or their key order", () => {
		const value = {
			z: [{ second: 2, first: 1 }],
			a: { nested: "value" },
		};
		const originalKeys = Object.keys(value);
		const originalNestedKeys = Object.keys(value.z[0]);
		Object.freeze(value.z[0]);
		Object.freeze(value.z);
		Object.freeze(value.a);
		Object.freeze(value);

		expect(() => flattenObjectPropertyEntries(value)).not.toThrow();
		expect(Object.keys(value)).toEqual(originalKeys);
		expect(Object.keys(value.z[0])).toEqual(originalNestedKeys);
		expect(value).toEqual({
			z: [{ second: 2, first: 1 }],
			a: { nested: "value" },
		});
	});
});
