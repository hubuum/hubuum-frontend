import { describe, expect, it } from "vitest";
import {
	buildSearchHydration,
	parseSearchHydration,
} from "@/lib/search-hydration";
import type { SearchHydrationResponse } from "@/lib/api/generated/models";

const timestamp = "2026-10-17T12:00:00";
const record = { created_at: timestamp, updated_at: timestamp, revision: 1 };
const object = (id: number, classId: number) => ({
	...record,
	id,
	hubuum_class_id: classId,
	collection_id: 42,
	name: `object-${id}`,
	description: "",
	data: {},
});
const relation = (id: number, from: number, to: number) => ({
	...record,
	id,
	from_hubuum_object_id: from,
	to_hubuum_object_id: to,
	class_relation_id: 5,
});
const request = buildSearchHydration(
	{ classId: "13", depth: 3, limit: 25 },
	object(10, 12),
);
const response = (): SearchHydrationResponse => ({
	version: 1,
	root_object_id: 10,
	target_class_id: 13,
	depth: 3,
	limit: 25,
	truncated: false,
	objects: [object(10, 12), object(11, 14), object(20, 13), object(21, 13)],
	relations: [relation(1, 10, 11), relation(2, 20, 11), relation(3, 11, 21)],
	paths: [
		{ object_ids: [10, 11, 20], relation_ids: [1, 2] },
		{ object_ids: [10, 11, 21], relation_ids: [1, 3] },
	],
});

describe("search hydration", () => {
	it("builds an independent ID-backed hydration request", () => {
		expect(request).toEqual({
			version: 1,
			root_class_id: 12,
			root_object_id: 10,
			class: { id: 13 },
			depth: 3,
			limit: 25,
		});
	});
	it("handles reverse edges, shared intermediate objects and duplicate resources", () => {
		const data = response();
		data.objects.push(data.objects[1]);
		data.relations.push(data.relations[0]);
		data.paths.push(data.paths[0]);
		const parsed = parseSearchHydration(data, request);
		expect(parsed.objects).toHaveLength(4);
		expect(parsed.relations).toHaveLength(3);
		expect(parsed.paths).toHaveLength(2);
	});
	it("keeps truncation explicit", () => {
		expect(
			parseSearchHydration({ ...response(), truncated: true }, request)
				.truncated,
		).toBe(true);
	});
	it.each([
		["root_object_id", 99],
		["target_class_id", 99],
		["depth", 4],
		["limit", 50],
		["version", 2],
		["truncated", undefined],
	] as const)("rejects stale or malformed %s", (key, value) => {
		expect(() =>
			parseSearchHydration({ ...response(), [key]: value }, request),
		).toThrow("invalid or incomplete");
	});
	it("rejects paths through omitted or hidden objects and relations", () => {
		for (const key of ["objects", "relations"] as const) {
			const data = response();
			data[key].splice(1, 1);
			expect(() => parseSearchHydration(data, request)).toThrow(
				"invalid or incomplete",
			);
		}
	});
	it("rejects cycles and mismatched edges", () => {
		const cycle = response();
		cycle.paths[0] = { object_ids: [10, 11, 10, 20], relation_ids: [1, 1, 2] };
		expect(() => parseSearchHydration(cycle, request)).toThrow();
		const wrongEdge = response();
		wrongEdge.paths[0].relation_ids[1] = 3;
		expect(() => parseSearchHydration(wrongEdge, request)).toThrow();
	});
	it("rejects unrelated context, conflicting duplicates and out-of-scope endpoints", () => {
		const unrelated = response();
		unrelated.objects.push(object(99, 13));
		expect(() => parseSearchHydration(unrelated, request)).toThrow();
		const conflict = response();
		conflict.objects.push({ ...conflict.objects[0], name: "different" });
		expect(() => parseSearchHydration(conflict, request)).toThrow();
		const moved = response();
		moved.objects[2].hubuum_class_id = 100;
		expect(() => parseSearchHydration(moved, request)).toThrow();
	});
	it("enforces per-root path limits and supports empty neighborhoods", () => {
		const data = { ...response(), limit: 1 };
		expect(() =>
			parseSearchHydration(data, { ...request, limit: 1 }),
		).toThrow();
		expect(
			parseSearchHydration(
				{ ...response(), objects: [], relations: [], paths: [] },
				request,
			).paths,
		).toEqual([]);
	});
});
