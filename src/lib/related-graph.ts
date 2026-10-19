import type {
	RelatedClassGraph,
	RelatedObjectGraph,
} from "@/lib/api/generated/models";

export type GraphScope =
	| { type: "class"; classId: number }
	| { type: "object"; classId: number; objectId: number };
export type GraphBounds = { depth: number; limit: number };
export type GraphNode = {
	id: number;
	name: string;
	description: string;
	href: string;
	path: number[];
	x: number;
	y: number;
};
export type GraphEdge = { id: number; from: number; to: number };
export type NeighborhoodGraph = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	width: number;
	height: number;
	rootId: number;
};

export function graphResourceHref(scope: GraphScope) {
	return scope.type === "class"
		? `/classes/${scope.classId}`
		: `/objects/${scope.classId}/${scope.objectId}`;
}

export function validateGraphBounds(bounds: GraphBounds) {
	if (
		!Number.isSafeInteger(bounds.depth) ||
		bounds.depth < 1 ||
		bounds.depth > 10 ||
		!Number.isSafeInteger(bounds.limit) ||
		bounds.limit < 1 ||
		bounds.limit > 250
	)
		throw new Error(
			"Choose a depth from 1 to 10 and a related-node limit from 1 to 250.",
		);
}

/** Deduplicate alternate paths, then lay out nodes by shortest distance from the root. */
export function layoutRelatedGraph(
	graph: RelatedClassGraph | RelatedObjectGraph,
	scope: GraphScope,
	bounds: GraphBounds,
): NeighborhoodGraph {
	validateGraphBounds(bounds);
	const rootId = scope.type === "class" ? scope.classId : scope.objectId;
	const resources = "classes" in graph ? graph.classes : graph.objects;
	if (
		!Array.isArray(resources) ||
		resources.length > bounds.limit + 1 ||
		!Array.isArray(graph.relations)
	)
		throw new Error(
			"Invalid or oversized neighborhood graph. Reduce the depth or node limit.",
		);
	if (graph.relations.length > 5000)
		throw new Error(
			"This neighborhood has more than 5,000 direct relations. Reduce the depth or node limit.",
		);
	const nodesById = new Map<number, GraphNode>();
	for (const item of resources) {
		if (
			!item ||
			!Number.isSafeInteger(item.id) ||
			item.id < 1 ||
			typeof item.name !== "string" ||
			typeof item.description !== "string" ||
			!Array.isArray(item.path) ||
			!item.path.length ||
			item.path.length > bounds.depth + 1 ||
			item.path[0] !== rootId ||
			item.path.at(-1) !== item.id ||
			!item.path.every((id) => Number.isSafeInteger(id) && id > 0)
		)
			throw new Error("Invalid neighborhood node or path.");
		if (
			scope.type === "object" &&
			(!("hubuum_class_id" in item) ||
				!Number.isSafeInteger(item.hubuum_class_id) ||
				item.hubuum_class_id < 1)
		)
			throw new Error("Invalid object class in neighborhood graph.");
		const previous = nodesById.get(item.id);
		if (!previous || item.path.length < previous.path.length)
			nodesById.set(item.id, {
				id: item.id,
				name: item.name,
				description: item.description,
				path: item.path,
				href:
					scope.type === "class"
						? `/classes/${item.id}`
						: `/objects/${"hubuum_class_id" in item ? item.hubuum_class_id : scope.classId}/${item.id}`,
				x: 0,
				y: 0,
			});
	}
	if (!nodesById.has(rootId))
		throw new Error("The neighborhood graph is missing its root.");
	const edgesById = new Map<number, GraphEdge>();
	for (const relation of graph.relations) {
		const from =
			"from_hubuum_class_id" in relation
				? relation.from_hubuum_class_id
				: relation.from_hubuum_object_id;
		const to =
			"to_hubuum_class_id" in relation
				? relation.to_hubuum_class_id
				: relation.to_hubuum_object_id;
		if (
			!Number.isSafeInteger(relation.id) ||
			relation.id < 1 ||
			!nodesById.has(from) ||
			!nodesById.has(to)
		)
			throw new Error("Invalid direct relation in neighborhood graph.");
		edgesById.set(relation.id, { id: relation.id, from, to });
	}
	const nodes = [...nodesById.values()].sort(
		(a, b) =>
			a.path.length - b.path.length ||
			a.name.localeCompare(b.name) ||
			a.id - b.id,
	);
	const counts = new Map<number, number>();
	for (const node of nodes) {
		const depth = node.path.length - 1;
		node.x = 24 + depth * 260;
		node.y = 32 + (counts.get(depth) ?? 0) * 84;
		counts.set(depth, (counts.get(depth) ?? 0) + 1);
	}
	return {
		nodes,
		edges: [...edgesById.values()],
		rootId,
		width: Math.max(520, ...nodes.map((node) => node.x + 236)),
		height: Math.max(180, ...nodes.map((node) => node.y + 88)),
	};
}
