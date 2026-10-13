import type { EventListOptions, EventRecord } from "@/lib/api/events";

export type AuditFilterDraft = {
	action: string;
	actorKind: string;
	actorUserId: string;
	collectionId: string;
	entityId: string;
	entityName: string;
	entityMatch: string;
	entityType: string;
	initiatorUserId: string;
	occurredAfter: string;
	occurredBefore: string;
};

export type AuditFilterField = keyof AuditFilterDraft;
export type AuditDrilldownDimension =
	| "action"
	| "actor"
	| "collection"
	| "entity"
	| "entityName"
	| "initiator";

export const EMPTY_AUDIT_FILTER_DRAFT: AuditFilterDraft = {
	action: "",
	actorKind: "",
	actorUserId: "",
	collectionId: "",
	entityId: "",
	entityName: "",
	entityMatch: "id",
	entityType: "",
	initiatorUserId: "",
	occurredAfter: "",
	occurredBefore: "",
};

export function parseAuditFilterParams(
	params: Pick<URLSearchParams, "get">,
): AuditFilterDraft {
	const draft = { ...EMPTY_AUDIT_FILTER_DRAFT };
	for (const field of Object.keys(draft) as AuditFilterField[]) {
		draft[field] = params.get(field) ?? draft[field];
	}
	draft.entityMatch = draft.entityMatch === "name" ? "name" : "id";
	return draft;
}

function parsePositiveInteger(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const parsed = Number.parseInt(trimmed, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function buildAuditEventFilters(
	draft: AuditFilterDraft,
): EventListOptions {
	return {
		action: draft.action.trim() || undefined,
		actor_kind: draft.actorKind.trim() || undefined,
		actor_user_id: parsePositiveInteger(draft.actorUserId),
		collection_id: parsePositiveInteger(draft.collectionId),
		entity_id:
			draft.entityMatch === "name"
				? undefined
				: parsePositiveInteger(draft.entityId),
		entity_name: draft.entityMatch === "name" ? draft.entityName : undefined,
		entity_type: draft.entityType.trim() || undefined,
		initiator_user_id: parsePositiveInteger(draft.initiatorUserId),
		limit: 50,
		occurred_after: draft.occurredAfter.trim() || undefined,
		occurred_before: draft.occurredBefore.trim() || undefined,
		sort: "-occurred_at,-id",
	};
}

export function clearAuditFilter(
	draft: AuditFilterDraft,
	field: AuditFilterField,
): AuditFilterDraft {
	if (field === "entityName")
		return { ...draft, entityName: "", entityId: "", entityMatch: "id" };
	return { ...draft, [field]: "" };
}

export function getAuditDrilldownDraft(
	draft: AuditFilterDraft,
	event: EventRecord,
	dimension: AuditDrilldownDimension,
): AuditFilterDraft | null {
	if (dimension === "action") {
		return { ...draft, action: event.action };
	}

	if (dimension === "collection") {
		return event.collection_id == null
			? null
			: { ...draft, collectionId: String(event.collection_id) };
	}

	if (dimension === "entityName" && !event.entity_name) return null;
	if (dimension === "entity" || dimension === "entityName") {
		return {
			...draft,
			entityMatch: dimension === "entityName" ? "name" : "id",
			entityName: event.entity_name ?? "",
			entityId: event.entity_id == null ? "" : String(event.entity_id),
			entityType: event.entity_type,
		};
	}

	if (dimension === "initiator") {
		const initiatorId = event.provenance.initiator?.principal_id;
		return initiatorId == null
			? null
			: { ...draft, initiatorUserId: String(initiatorId) };
	}

	const actorKind =
		event.provenance.actor.kind?.trim() || event.actor_kind.trim();
	const actorId =
		event.provenance.actor.principal?.principal_id ?? event.actor_user_id;
	if (!actorKind && actorId == null) {
		return null;
	}

	return {
		...draft,
		actorKind,
		actorUserId: actorId == null ? "" : String(actorId),
	};
}
