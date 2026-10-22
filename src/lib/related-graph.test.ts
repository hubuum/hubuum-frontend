import { expect, it } from "vitest";
import type {
	HubuumClassWithPath,
	RelatedClassGraph,
} from "@/lib/api/generated/models";
import { layoutRelatedGraph } from "@/lib/related-graph";

const node = (id: number, path: number[]): HubuumClassWithPath => ({
	id,
	path,
	name: `Class ${id}`,
	description: "",
	collection_id: 1,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	revision: 1,
	validate_schema: false,
});
const scope = { type: "class", classId: 1 } as const;
const bounds = { depth: 3, limit: 25 };
const graph: RelatedClassGraph = {
	classes: [node(3, [1, 2, 3]), node(2, [1, 2]), node(1, [1]), node(3, [1, 3])],
	relations: [
		{
			id: 10,
			from_hubuum_class_id: 2,
			to_hubuum_class_id: 3,
			revision: 1,
			created_at: "",
			updated_at: "",
		},
	],
};

it("deduplicates alternate paths and lays out stable shortest-distance columns with direct edges", () => {
	const result = layoutRelatedGraph(graph, scope, bounds);
	expect(result.nodes.map((node) => [node.id, node.path])).toEqual([
		[1, [1]],
		[2, [1, 2]],
		[3, [1, 3]],
	]);
	expect(result.nodes[0].x).toBeLessThan(result.nodes[1].x);
	expect(result.nodes[1].x).toBe(result.nodes[2].x);
	expect(result.nodes[1].y).toBeLessThan(result.nodes[2].y);
	expect(result.edges).toEqual([{ id: 10, from: 2, to: 3 }]);
	expect(
		result.nodes.every(
			(node) => node.x < result.width && node.y < result.height,
		),
	).toBe(true);
});
it("links each object using its own class", () => {
	const result = layoutRelatedGraph(
		{
			class_relations: [],
			objects: [
				{ ...node(1, [1]), data: {}, hubuum_class_id: 15 },
				{ ...node(2, [1, 2]), data: {}, hubuum_class_id: 20 },
			],
			relations: [],
		},
		{ type: "object", classId: 15, objectId: 1 },
		bounds,
	);
	expect(result.nodes[1].href).toBe("/objects/20/2");
});
it("rejects unbounded or invalid controls", () => {
	for (const invalid of [
		{ depth: 0, limit: 25 },
		{ depth: 11, limit: 25 },
		{ depth: 2, limit: 2001 },
		{ depth: 2, limit: NaN },
	])
		expect(() => layoutRelatedGraph(graph, scope, invalid)).toThrow(
			"Choose a depth",
		);
});
it("wraps large depth groups without overlap or changing paths", () => {
	const result = layoutRelatedGraph(
		{
			classes: [
				node(1, [1]),
				...Array.from({ length: 2000 }, (_, index) =>
					node(index + 2, [1, index + 2]),
				),
			],
			relations: [],
		},
		scope,
		{ depth: 1, limit: 2000 },
	);
	expect(result.nodes).toHaveLength(2001);
	expect(result.height).toBeLessThan(1200);
	expect(new Set(result.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(
		2001,
	);
	expect(
		result.nodes.every(
			(node) => node.x + 212 <= result.width && node.y + 60 <= result.height,
		),
	).toBe(true);
	expect(result.nodes.at(-1)?.path[0]).toBe(1);
});
it("rejects oversized graphs rather than silently truncating", () => {
	expect(() =>
		layoutRelatedGraph(graph, scope, { depth: 3, limit: 1 }),
	).toThrow("oversized");
	expect(() =>
		layoutRelatedGraph(
			{ ...graph, relations: Array(5001).fill(graph.relations[0]) },
			scope,
			bounds,
		),
	).toThrow("5,000");
});
it("rejects missing roots, invalid paths, and edges outside the neighborhood", () => {
	expect(() =>
		layoutRelatedGraph(
			{ classes: [node(2, [1, 2])], relations: [] },
			scope,
			bounds,
		),
	).toThrow("missing its root");
	expect(() =>
		layoutRelatedGraph(
			{ classes: [node(1, [1]), node(2, [99, 2])], relations: [] },
			scope,
			bounds,
		),
	).toThrow("node or path");
	expect(() =>
		layoutRelatedGraph({ ...graph, classes: [node(1, [1])] }, scope, bounds),
	).toThrow("direct relation");
});
