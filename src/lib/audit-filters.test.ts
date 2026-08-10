import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/lib/api/events";
import {
	buildAuditEventFilters,
	clearAuditFilter,
	EMPTY_AUDIT_FILTER_DRAFT,
	getAuditDrilldownDraft,
} from "@/lib/audit-filters";

function eventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
	return {
		action: "updated",
		actor_kind: "worker",
		actor_user_id: null,
		collection_id: 8,
		correlation_id: null,
		entity_id: 14,
		entity_name: "example",
		entity_type: "object",
		event_id: "event-1",
		id: 1,
		metadata: {},
		occurred_at: "2026-08-10T12:00:00Z",
		provenance: {
			actor: {
				kind: "service_account",
				principal: { name: "sync", principal_id: 23 },
			},
			initiator: { name: "alice", principal_id: 4 },
			task_id: 9,
		},
		request_id: null,
		schema_version: 1,
		summary: "Updated example",
		...overrides,
	};
}

describe("audit filters", () => {
	it("builds backend filters from a form draft", () => {
		expect(
			buildAuditEventFilters({
				...EMPTY_AUDIT_FILTER_DRAFT,
				action: " updated ",
				actorUserId: "23",
				collectionId: "8",
				entityId: "not-an-id",
				entityType: " object ",
				occurredAfter: "2026-08-01",
			}),
		).toEqual({
			action: "updated",
			actor_kind: undefined,
			actor_user_id: 23,
			collection_id: 8,
			entity_id: undefined,
			entity_type: "object",
			initiator_user_id: undefined,
			limit: 50,
			occurred_after: "2026-08-01",
			occurred_before: undefined,
			sort: "-occurred_at,-id",
		});
	});

	it("piles actor and action drill-down values onto existing filters", () => {
		const withCollection = {
			...EMPTY_AUDIT_FILTER_DRAFT,
			collectionId: "8",
		};
		const withActor = getAuditDrilldownDraft(
			withCollection,
			eventRecord(),
			"actor",
		);

		expect(withActor).toMatchObject({
			actorKind: "service_account",
			actorUserId: "23",
			collectionId: "8",
		});
		expect(
			getAuditDrilldownDraft(
				withActor ?? withCollection,
				eventRecord(),
				"action",
			),
		).toMatchObject({
			action: "updated",
			actorKind: "service_account",
			actorUserId: "23",
			collectionId: "8",
		});
	});

	it("drills into the resolved initiator and clears one filter at a time", () => {
		const withInitiator = getAuditDrilldownDraft(
			EMPTY_AUDIT_FILTER_DRAFT,
			eventRecord(),
			"initiator",
		);
		expect(withInitiator?.initiatorUserId).toBe("4");
		expect(
			clearAuditFilter(
				withInitiator ?? EMPTY_AUDIT_FILTER_DRAFT,
				"initiatorUserId",
			),
		).toEqual(EMPTY_AUDIT_FILTER_DRAFT);
	});

	it("does not offer unavailable collection or initiator drill-downs", () => {
		const event = eventRecord({
			collection_id: null,
			provenance: {
				actor: { kind: "system", principal: null },
				initiator: null,
				task_id: null,
			},
		});

		expect(
			getAuditDrilldownDraft(EMPTY_AUDIT_FILTER_DRAFT, event, "collection"),
		).toBeNull();
		expect(
			getAuditDrilldownDraft(EMPTY_AUDIT_FILTER_DRAFT, event, "initiator"),
		).toBeNull();
	});
});
