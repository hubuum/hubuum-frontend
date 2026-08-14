import type { EventListOptions, EventRecord } from "@/lib/api/events";

export type AuditFilterDraft = {
	action: string;
	actorKind: string;
	actorUserId: string;
	collectionId: string;
	entityId: string;
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
	| "initiator";

export const EMPTY_AUDIT_FILTER_DRAFT: AuditFilterDraft = {
	action: "",
	actorKind: "",
	actorUserId: "",
	collectionId: "",
	entityId: "",
	entityType: "",
	initiatorUserId: "",
	occurredAfter: "",
	occurredBefore: "",
};

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
		entity_id: parsePositiveInteger(draft.entityId),
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

	if (dimension === "entity") {
		return {
			...draft,
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
