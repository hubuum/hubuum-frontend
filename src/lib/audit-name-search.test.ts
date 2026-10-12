import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type EventRecord,
	fetchEventsPage,
	fetchResourceEventsPage,
} from "@/lib/api/events";
import {
	buildAuditEventFilters,
	clearAuditFilter,
	getAuditDrilldownDraft,
	parseAuditFilterParams,
} from "@/lib/audit-filters";
import { buildAuditNameSearch } from "@/lib/audit-name-search";
import { groupHistoryEvents, namedHistoryHref } from "@/lib/resource-history";

const scope = { type: "object" as const, classId: 3, objectId: 12 };
function event(
	id: number,
	entityId: number,
	overrides: Partial<EventRecord> = {},
): EventRecord {
	return {
		id,
		event_id: `event-${id}`,
		entity_type: "object",
		entity_id: entityId,
		entity_name: "my-server",
		action: "deleted",
		actor_kind: "user",
		occurred_at: "2026-10-01T00:00:00Z",
		summary: "Deleted",
		schema_version: 1,
		metadata: {},
		provenance: { actor: {} },
		...overrides,
	};
}
afterEach(() => vi.unstubAllGlobals());

describe("name-scoped audit requests", () => {
	it("preserves other filters and exact names, replacing the ID predicate", () => {
		const draft = parseAuditFilterParams(
			new URLSearchParams(
				"entityMatch=name&entityName=my-server&entityId=12&entityType=object&collectionId=7&actorUserId=2&action=deleted&occurredAfter=2026-10-01",
			),
		);
		const request = buildAuditNameSearch({
			...buildAuditEventFilters(draft),
			entity_id: 99,
			occurred_before: "2026-10-02T01:02:03.123456Z",
			include_total: false,
			cursor: "next",
		});
		expect(request).toMatchObject({
			target: { kind: "audit_event" },
			cursor: "next",
			include_total: false,
			filter: {
				op: "and",
				args: [
					{
						op: "field",
						predicate: {
							field: "entity_name",
							operator: "equals",
							value: "my-server",
						},
					},
					{
						op: "field",
						predicate: {
							field: "entity_type",
							operator: "equals",
							value: "object",
						},
					},
					{
						op: "field",
						predicate: {
							field: "action",
							operator: "equals",
							value: "deleted",
						},
					},
					{
						op: "field",
						predicate: { field: "actor_user_id", operator: "equals", value: 2 },
					},
					{
						op: "field",
						predicate: { field: "collection_id", operator: "equals", value: 7 },
					},
					{
						op: "field",
						predicate: {
							field: "occurred_at",
							operator: "gte",
							value: "2026-10-01T00:00:00Z",
						},
					},
					{
						op: "field",
						predicate: {
							field: "occurred_at",
							operator: "lte",
							value: "2026-10-02T01:02:03.123456Z",
						},
					},
				],
			},
		});
		expect(
			buildAuditNameSearch({ entity_name: " Name " }).filter,
		).toMatchObject({ predicate: { value: " Name " } });
		expect(() => buildAuditNameSearch({ entity_name: " " })).toThrow(
			"exact recorded name",
		);
		const byId = getAuditDrilldownDraft(draft, event(1, 27), "entity");
		expect(byId && buildAuditEventFilters(byId)).toMatchObject({
			entity_id: 27,
			entity_name: undefined,
			collection_id: 7,
		});
		expect(clearAuditFilter(draft, "entityName")).toMatchObject({
			entityMatch: "id",
			entityId: "",
			entityName: "",
		});
		expect(
			parseAuditFilterParams(new URLSearchParams("entityId=12")).entityMatch,
		).toBe("id");
		expect(
			getAuditDrilldownDraft(
				draft,
				event(1, 27, { entity_name: null }),
				"entityName",
			),
		).toBeNull();
	});
	it("uses BFF structured results and envelope pagination without a live-resource restriction", async () => {
		const item = event(1, 27);
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						kind: "audit_event",
						results: [{ kind: "audit_event", resource: item }],
						next: "older",
						total: 3,
					}),
				),
			);
		vi.stubGlobal("fetch", fetch);
		expect(
			await fetchResourceEventsPage(scope, { entity_name: "my-server" }),
		).toEqual({ items: [item], nextCursor: "older", totalCount: 3 });
		const [url, options] = fetch.mock.calls[0];
		expect(url).toBe("/_hubuum-bff/hubuum/api/v1/search");
		expect(options).toMatchObject({ method: "POST", credentials: "include" });
		expect(options.body).not.toContain("entity_id");
		expect(options.body).not.toContain("class_id");
	});
	it.each([403, 404, 400])(
		"reports %i without falling back to an unfiltered or ID feed",
		async (status) => {
			const fetch = vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ message: "Search unavailable" }), {
						status,
					}),
				);
			vi.stubGlobal("fetch", fetch);
			await expect(
				fetchEventsPage({ entity_name: "my-server" }),
			).rejects.toThrow("Search unavailable");
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);
});

describe("grouped history discovery", () => {
	it("deduplicates IDs across pages, recovers deleted scopes and leaves unresolved IDs visible", () => {
		const first = event(9, 12);
		const missing = event(8, 27);
		expect(
			groupHistoryEvents(
				[
					first,
					missing,
					first,
					event(7, 27, { before: { hubuum_class_id: 8 } }),
					event(6, 39),
					event(5, 12, { entity_type: "class" }),
					event(4, 12, { entity_id: null }),
				],
				scope,
			),
		).toEqual([
			{ id: 12, scope, eventCount: 1 },
			{
				id: 27,
				scope: { type: "object", classId: 8, objectId: 27 },
				eventCount: 2,
			},
			{ id: 39, scope: null, eventCount: 1 },
		]);
	});
	it("opens a fresh ID route, retaining only the name-discovery context", () => {
		const href = namedHistoryHref(
			{ type: "object", classId: 8, objectId: 27 },
			"server & old",
		);
		const url = new URL(href, "https://example.test");
		expect(url.pathname).toBe("/objects/8/27/history");
		expect([...url.searchParams]).toEqual([
			["historyMatch", "name"],
			["historyName", "server & old"],
		]);
		expect(
			groupHistoryEvents([event(1, 5, { entity_type: "class" })], {
				type: "class",
				classId: 3,
			})[0].scope,
		).toEqual({ type: "class", classId: 5 });
	});
});
