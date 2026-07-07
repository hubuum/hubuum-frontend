import type { Collection } from "@/lib/api/generated/models";

export type CollectionHierarchyNode = {
	collection: Collection;
	children: CollectionHierarchyNode[];
	depth: number;
	path: Collection[];
};

export type CollectionHierarchy = {
	nodes: CollectionHierarchyNode[];
	flatNodes: CollectionHierarchyNode[];
	byId: Map<number, Collection>;
	childrenByParentId: Map<number | null, Collection[]>;
	orphanCollections: Collection[];
};

function parentIdOf(collection: Collection): number | null {
	return collection.parent_collection_id ?? null;
}

function compareCollections(left: Collection, right: Collection): number {
	const nameComparison = left.name.localeCompare(right.name);
	return nameComparison === 0 ? left.id - right.id : nameComparison;
}

export function isRootCollection(collection: Collection): boolean {
	return parentIdOf(collection) === null;
}

export function buildCollectionHierarchy(
	collections: readonly Collection[],
): CollectionHierarchy {
	const byId = new Map<number, Collection>();
	const childrenByParentId = new Map<number | null, Collection[]>();

	for (const collection of collections) {
		byId.set(collection.id, collection);
		const parentId = parentIdOf(collection);
		const children = childrenByParentId.get(parentId) ?? [];
		children.push(collection);
		childrenByParentId.set(parentId, children);
	}

	for (const children of childrenByParentId.values()) {
		children.sort(compareCollections);
	}

	const flatNodes: CollectionHierarchyNode[] = [];
	const orphanCollections: Collection[] = [];
	const visited = new Set<number>();

	function visit(
		collection: Collection,
		depth: number,
		path: Collection[],
		activePath: Set<number>,
	): CollectionHierarchyNode {
		const nodePath = [...path, collection];
		const node: CollectionHierarchyNode = {
			collection,
			children: [],
			depth,
			path: nodePath,
		};
		flatNodes.push(node);
		visited.add(collection.id);

		const childActivePath = new Set(activePath);
		childActivePath.add(collection.id);
		const children = childrenByParentId.get(collection.id) ?? [];
		node.children = children
			.filter((child) => !childActivePath.has(child.id))
			.map((child) => visit(child, depth + 1, nodePath, childActivePath));

		return node;
	}

	const roots = childrenByParentId.get(null) ?? [];
	const nodes = roots.map((collection) => visit(collection, 0, [], new Set()));

	const disconnected = collections
		.filter((collection) => !visited.has(collection.id))
		.sort(compareCollections);
	for (const collection of disconnected) {
		orphanCollections.push(collection);
		nodes.push(visit(collection, 0, [], new Set()));
	}

	return {
		nodes,
		flatNodes,
		byId,
		childrenByParentId,
		orphanCollections,
	};
}

export function formatCollectionPath(
	path: readonly Collection[],
	options: { includeIds?: boolean } = {},
): string {
	const includeIds = options.includeIds ?? true;
	return path
		.map((collection) =>
			includeIds ? `${collection.name} (#${collection.id})` : collection.name,
		)
		.join(" / ");
}

export function getCollectionPath(
	collection: Collection,
	collectionsById: ReadonlyMap<number, Collection>,
): Collection[] {
	const path: Collection[] = [];
	const visited = new Set<number>();
	let current: Collection | undefined = collection;

	while (current && !visited.has(current.id)) {
		path.unshift(current);
		visited.add(current.id);
		const parentId = parentIdOf(current);
		current = parentId === null ? undefined : collectionsById.get(parentId);
	}

	return path;
}

export function getCollectionPathLabel(
	collection: Collection,
	collectionsById: ReadonlyMap<number, Collection>,
): string {
	return formatCollectionPath(getCollectionPath(collection, collectionsById));
}

export function getDescendantCollectionIds(
	collectionId: number,
	childrenByParentId: ReadonlyMap<number | null, readonly Collection[]>,
): Set<number> {
	const descendants = new Set<number>();
	const queue = [...(childrenByParentId.get(collectionId) ?? [])];

	while (queue.length > 0) {
		const child = queue.shift();
		if (!child || descendants.has(child.id)) {
			continue;
		}

		descendants.add(child.id);
		queue.push(...(childrenByParentId.get(child.id) ?? []));
	}

	return descendants;
}

export function getDuplicateCollectionNames(
	collections: readonly Collection[],
): Set<string> {
	const counts = new Map<string, number>();
	for (const collection of collections) {
		const key = collection.name.trim().toLocaleLowerCase();
		if (!key) {
			continue;
		}
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return new Set(
		Array.from(counts.entries())
			.filter(([, count]) => count > 1)
			.map(([name]) => name),
	);
}

export function formatCollectionOption(
	collection: Collection,
	collectionsById: ReadonlyMap<number, Collection>,
): string {
	const path = getCollectionPath(collection, collectionsById);
	return path.length > 1
		? formatCollectionPath(path)
		: `${collection.name} (#${collection.id})`;
}
