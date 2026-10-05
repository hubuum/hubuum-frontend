import type { EventSubscriptionFilter } from "@/lib/api/generated/models";

// Task-kind filters can be configured through the API but have no console input.
// Preserve them while allowing the editable filter fields to be cleared.
export function preserveTaskKindFilter(
	edited: EventSubscriptionFilter | undefined,
	original: EventSubscriptionFilter | undefined,
): EventSubscriptionFilter | undefined {
	return original?.task_kinds?.length
		? { ...edited, task_kinds: original.task_kinds }
		: edited;
}
