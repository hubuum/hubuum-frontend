import { describe, expect, it } from "vitest";

import {
	buildRelatedObjectSearchParams,
	DEFAULT_INCLUDE_SELF_CLASS,
	DEFAULT_RELATED_OBJECT_DEPTH_LIMIT,
	MAX_RELATED_OBJECT_DEPTH_LIMIT,
	normalizeRelatedObjectPath,
	normalizeRelatedObjectDepthLimit,
	summarizeRelatedObjectData,
} from "@/lib/object-relation-summary";

describe("object relation summaries", () => {
	it("excludes same-class objects from the default detail request", () => {
		expect(DEFAULT_INCLUDE_SELF_CLASS).toBe(false);
		const params = buildRelatedObjectSearchParams({
			depthLimit: 2,
			includeSelfClass: DEFAULT_INCLUDE_SELF_CLASS,
			ignoredClassIds: [],
		});

		expect(params.get("limit")).toBe("250");
		expect(params.get("sort")).toBe("path.asc,id.asc");
		expect(params.get("depth__lte")).toBe("2");
		expect(params.get("ignore_self_class")).toBe("true");
		expect(params.has("ignore_classes")).toBe(false);
	});

	it("opts into same-class objects and serializes hidden classes", () => {
		const params = buildRelatedObjectSearchParams({
			depthLimit: 9,
			includeSelfClass: true,
			ignoredClassIds: [9, 12],
			limit: 50,
		});

		expect(params.toString()).toBe(
			"limit=50&sort=path.asc%2Cid.asc&depth__lte=9&ignore_self_class=false&ignore_classes=9%2C12",
		);
	});

	it("defaults and bounds the reachability depth", () => {
		expect(DEFAULT_RELATED_OBJECT_DEPTH_LIMIT).toBe(2);
		expect(MAX_RELATED_OBJECT_DEPTH_LIMIT).toBe(10);
		expect(normalizeRelatedObjectDepthLimit(null)).toBe(2);
		expect(normalizeRelatedObjectDepthLimit("3")).toBe(3);
		expect(normalizeRelatedObjectDepthLimit("0")).toBe(2);
		expect(normalizeRelatedObjectDepthLimit("11")).toBe(2);
		expect(normalizeRelatedObjectDepthLimit("2.5")).toBe(2);
		expect(normalizeRelatedObjectDepthLimit("invalid")).toBe(2);
	});

	it("normalizes root-prefixed, partial, and empty paths", () => {
		expect(normalizeRelatedObjectPath(10, 30, [10, 20, 30])).toEqual([20, 30]);
		expect(normalizeRelatedObjectPath(10, 30, [20])).toEqual([20, 30]);
		expect(normalizeRelatedObjectPath(10, 30, [])).toEqual([30]);
	});

	it("builds a stable compact preview of top-level data", () => {
		expect(
			summarizeRelatedObjectData(
				{ tags: ["prod", "web"], hostname: "server-1", owner: { id: 7 } },
				2,
			),
		).toEqual([
			{ label: "hostname", value: "server-1" },
			{ label: "owner", value: "1 field" },
		]);
	});

	it("returns no preview for non-object data", () => {
		expect(summarizeRelatedObjectData(["one", "two"])).toEqual([]);
		expect(summarizeRelatedObjectData(null)).toEqual([]);
	});
});
