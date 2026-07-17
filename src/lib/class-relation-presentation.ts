import type { HubuumClassRelation } from "@/lib/api/generated/models";

export type ClassRelationPresentation = {
	relatedClassId: number;
	direction: "Outgoing" | "Incoming";
	alias: string | null | undefined;
};

export function presentClassRelation(
	relation: HubuumClassRelation,
	classId: number,
): ClassRelationPresentation {
	const isOutgoing = relation.from_hubuum_class_id === classId;

	return {
		relatedClassId: isOutgoing
			? relation.to_hubuum_class_id
			: relation.from_hubuum_class_id,
		direction: isOutgoing ? "Outgoing" : "Incoming",
		alias: isOutgoing
			? relation.forward_template_alias
			: relation.reverse_template_alias,
	};
}
