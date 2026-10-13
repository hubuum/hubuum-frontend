import type { EventListOptions } from "@/lib/api/events";
import type {
	StructuredSearchExpression,
	StructuredSearchField,
	StructuredSearchOperator,
	StructuredSearchRequest,
} from "@/lib/api/generated/models";

export function buildAuditNameSearch(
	options: EventListOptions,
): StructuredSearchRequest {
	if (!options.entity_name?.trim())
		throw new Error("Enter an exact recorded name.");
	const args: StructuredSearchExpression[] = [];
	function field(
		field: StructuredSearchField,
		value: unknown,
		operator: StructuredSearchOperator = "equals",
	) {
		if (value !== undefined && value !== "")
			args.push({ op: "field", predicate: { field, operator, value } });
	}
	field("entity_name", options.entity_name);
	for (const key of [
		"entity_type",
		"action",
		"actor_kind",
		"actor_user_id",
		"initiator_user_id",
		"collection_id",
	] as const) {
		field(key, options[key]);
	}
	const timestamp = (value: string | undefined) =>
		value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
	field("occurred_at", timestamp(options.occurred_after), "gte");
	field("occurred_at", timestamp(options.occurred_before), "lte");
	return {
		version: 1,
		target: { kind: "audit_event" },
		filter: args.length === 1 ? args[0] : { op: "and", args },
		sort: (options.sort ?? "-occurred_at,-id").split(",").map((sort) => {
			const descending = sort.startsWith("-");
			const key = descending ? sort.slice(1) : sort;
			if (key !== "id" && key !== "occurred_at")
				throw new Error("Unsupported audit sort field.");
			return { field: key, direction: descending ? "desc" : "asc" };
		}),
		cursor: options.cursor,
		limit: options.limit ?? 50,
		include_total: options.include_total ?? true,
	};
}
