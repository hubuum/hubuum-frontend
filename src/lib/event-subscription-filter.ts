import type { EventSubscriptionFilter } from "@/lib/api/generated/models";

// Clear fields controlled by the editor, preserving future server filter fields.
const EDITABLE_FILTERS = new Set([
	"actor_kinds",
	"actor_user_ids",
	"collection_ids",
	"correlation_ids",
	"entity_ids",
	"entity_names",
	"initiator_user_ids",
	"related_collection_ids",
	"request_ids",
	"subject_identity_scopes",
	"subject_is_admin",
	"subject_principal_ids",
	"task_kinds",
]);
export function mergeSubscriptionFilters(
	edited: EventSubscriptionFilter | undefined,
	original: EventSubscriptionFilter | undefined,
): EventSubscriptionFilter {
	const unknown: Record<string, unknown> = Object.fromEntries(
		Object.entries(original ?? {}).filter(
			([key]) => !EDITABLE_FILTERS.has(key),
		),
	);
	return { ...unknown, ...edited };
}

export function subscriptionSubjectIds(value: string): number[] | undefined {
	if (!value.trim()) return undefined;
	const values = value.split(",").map((id) => id.trim());
	if (
		values.some(
			(id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)),
		)
	)
		throw new Error(
			"Subject principal IDs must be comma-separated positive integers.",
		);
	return [...new Set(values.map(Number))];
}
