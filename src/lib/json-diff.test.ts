import { describe, expect, it } from "vitest";
import {
	buildJsonDifference,
	decodeNestedJsonStrings,
	formatJsonDifference,
	JSON_DIFF_MISSING_VALUE,
} from "@/lib/json-diff";

describe("buildJsonDifference", () => {
	it("preserves nesting while retaining only changed leaves", () => {
		expect(
			buildJsonDifference(
				{
					name: "before",
					stable: true,
					metadata: { owner: "one", retained: 4 },
				},
				{
					name: "after",
					stable: true,
					metadata: { owner: "two", retained: 4 },
				},
			),
		).toEqual({
			changeCount: 2,
			value: {
				metadata: {
					owner: { after: "two", before: "one" },
				},
				name: { after: "after", before: "before" },
			},
		});
	});

	it("marks added and removed values without losing their object path", () => {
		expect(
			buildJsonDifference(
				{ removed: 1, stable: true },
				{ added: 2, stable: true },
			),
		).toEqual({
			changeCount: 2,
			value: {
				added: { after: 2, before: JSON_DIFF_MISSING_VALUE },
				removed: { after: JSON_DIFF_MISSING_VALUE, before: 1 },
			},
		});
	});

	it("shows changed arrays as complete values", () => {
		expect(
			buildJsonDifference(["same", "old"], ["same", "new", "added"]),
		).toEqual({
			changeCount: 1,
			value: {
				after: ["same", "new", "added"],
				before: ["same", "old"],
			},
		});
	});

	it("expands JSON-encoded preference values inside the diff blob", () => {
		const preferenceKey = "hubuum.object-data-columns:1";
		const afterValue = JSON.stringify([
			JSON.stringify(["network", "interfaces", "[0]", "ipv4"]),
			JSON.stringify(["network", "interfaces", "[0]", "ipv6"]),
		]);

		expect(
			buildJsonDifference(
				{
					settings: {
						hubuum_frontend: { preferences: { [preferenceKey]: "[]" } },
					},
				},
				{
					settings: {
						hubuum_frontend: {
							preferences: { [preferenceKey]: afterValue },
						},
					},
				},
			),
		).toEqual({
			changeCount: 1,
			value: {
				settings: {
					hubuum_frontend: {
						preferences: {
							[preferenceKey]: {
								after: [
									["network", "interfaces", "[0]", "ipv4"],
									["network", "interfaces", "[0]", "ipv6"],
								],
								before: [],
							},
						},
					},
				},
			},
		});
	});

	it("returns null for structurally equal values", () => {
		expect(
			buildJsonDifference({ enabled: true }, { enabled: true }),
		).toBeNull();
	});
});

describe("decodeNestedJsonStrings", () => {
	it("decodes nested settings JSON without decoding path segment markers", () => {
		const encoded = JSON.stringify([
			JSON.stringify(["network", "interfaces", "[0]", "ipv4"]),
			JSON.stringify(["network", "interfaces", "[0]", "ipv6"]),
		]);

		expect(decodeNestedJsonStrings(encoded)).toEqual([
			["network", "interfaces", "[0]", "ipv4"],
			["network", "interfaces", "[0]", "ipv6"],
		]);
	});

	it("keeps ordinary strings and malformed JSON unchanged", () => {
		expect(decodeNestedJsonStrings("plain value")).toBe("plain value");
		expect(decodeNestedJsonStrings("[not-json]")).toBe("[not-json]");
	});
});

describe("formatJsonDifference", () => {
	it("formats the difference as readable JSON", () => {
		expect(
			formatJsonDifference({ enabled: { before: false, after: true } }),
		).toBe(
			'{\n  "enabled": {\n    "before": false,\n    "after": true\n  }\n}',
		);
	});
});
