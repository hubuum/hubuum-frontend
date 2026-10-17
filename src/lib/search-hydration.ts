import { z } from "zod";
import { resourceId, type SearchDraft } from "@/lib/advanced-search";
import type {
	HubuumObject,
	SearchHydrationRequest,
	SearchHydrationResponse,
} from "@/lib/api/generated/models";

const id = z.number().int().positive().max(2147483647);
const record = {
	id,
	created_at: z.string(),
	updated_at: z.string(),
	revision: z.number().int().positive(),
};
const objectSchema = z.object({
	...record,
	name: z.string(),
	description: z.string(),
	hubuum_class_id: id,
	collection_id: id,
	data: z.unknown(),
});
const relationSchema = z.object({
	...record,
	from_hubuum_object_id: id,
	to_hubuum_object_id: id,
	class_relation_id: id,
});
const responseSchema = z.object({
	version: z.literal(1),
	root_object_id: id,
	target_class_id: id,
	depth: z.number().int().min(1).max(10),
	limit: z.number().int().min(1).max(50),
	truncated: z.boolean(),
	objects: z.array(objectSchema).max(501),
	relations: z.array(relationSchema).max(500),
	paths: z
		.array(
			z.object({
				object_ids: z.array(id).min(2).max(11),
				relation_ids: z.array(id).min(1).max(10),
			}),
		)
		.max(50),
});

export function buildSearchHydration(
	settings: NonNullable<SearchDraft["hydration"]>,
	root: Pick<HubuumObject, "id" | "hubuum_class_id">,
): SearchHydrationRequest {
	return {
		version: 1,
		root_class_id: root.hubuum_class_id,
		root_object_id: root.id,
		class: { id: resourceId(settings.classId, "Related-resource class") },
		depth: settings.depth,
		limit: settings.limit,
	};
}

/** Reject mismatched or incomplete paths before displaying them as related. */
export function parseSearchHydration(
	payload: unknown,
	request: SearchHydrationRequest,
): SearchHydrationResponse {
	const parsed = responseSchema.safeParse(payload);
	const invalid = () =>
		new Error(
			"The server returned invalid or incomplete related-resource data. Retry inspection.",
		);
	if (!parsed.success) throw invalid();
	const data = parsed.data;
	if (
		data.root_object_id !== request.root_object_id ||
		data.depth !== request.depth ||
		data.limit !== request.limit ||
		!("id" in request.class) ||
		data.target_class_id !== request.class.id ||
		data.paths.length > request.limit ||
		data.objects.length > 1 + request.limit * request.depth ||
		data.relations.length > request.limit * request.depth
	)
		throw invalid();
	function unique<T extends { id: number }>(items: T[]): Map<number, T> {
		const map = new Map<number, T>();
		for (const item of items) {
			const existing = map.get(item.id);
			if (existing && JSON.stringify(existing) !== JSON.stringify(item))
				throw invalid();
			map.set(item.id, item);
		}
		return map;
	}
	const objects = unique(data.objects);
	const relations = unique(data.relations);
	const usedObjects = new Set<number>();
	const usedRelations = new Set<number>();
	for (const path of data.paths) {
		if (
			path.object_ids[0] !== request.root_object_id ||
			path.object_ids.length > request.depth + 1 ||
			new Set(path.object_ids).size !== path.object_ids.length ||
			path.relation_ids.length !== path.object_ids.length - 1 ||
			objects.get(request.root_object_id)?.hubuum_class_id !==
				request.root_class_id ||
			objects.get(path.object_ids[path.object_ids.length - 1])
				?.hubuum_class_id !== data.target_class_id
		)
			throw invalid();
		for (const id of path.object_ids) {
			if (!objects.has(id)) throw invalid();
			usedObjects.add(id);
		}
		for (const [index, id] of path.relation_ids.entries()) {
			const relation = relations.get(id);
			const from = path.object_ids[index];
			const to = path.object_ids[index + 1];
			if (
				!relation ||
				!(
					(relation.from_hubuum_object_id === from &&
						relation.to_hubuum_object_id === to) ||
					(relation.from_hubuum_object_id === to &&
						relation.to_hubuum_object_id === from)
				)
			)
				throw invalid();
			usedRelations.add(id);
		}
	}
	if (
		usedObjects.size !== objects.size ||
		usedRelations.size !== relations.size
	)
		throw invalid();
	return {
		...data,
		paths: [
			...new Map(
				data.paths.map((path) => [JSON.stringify(path), path]),
			).values(),
		],
		objects: [...objects.values()],
		relations: [...relations.values()],
	};
}
