import type { HubuumClassRelation } from "@/lib/api/generated/models";

export type ClassRelationFilters = {
	fromClassId: number | null;
	toClassId: number | null;
};

export function filterClassRelations(
	relations: HubuumClassRelation[],
	filters: ClassRelationFilters,
): HubuumClassRelation[] {
	return relations.filter(
		(relation) =>
			(filters.fromClassId === null ||
				relation.from_hubuum_class_id === filters.fromClassId) &&
			(filters.toClassId === null ||
				relation.to_hubuum_class_id === filters.toClassId),
	);
}
