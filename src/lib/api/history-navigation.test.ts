import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchHistoryTimeline,
	fetchHistoryEntry,
	fetchHistoricalRelations,
	fetchHistoricalPopulation,
	fetchHistoricalComputed,
} from "@/lib/api/history-navigation";

const scope = { type: "object", classId: 3, objectId: 12 } as const;
const at = "2026-09-24T08:42:13.830219Z";
const marker = {
	id: 12,
	hubuum_class_id: 3,
	collection_id: 4,
	history_id: 41,
	revision: 2,
	name: "Stored name",
	op: "U",
	valid_from: at,
	valid_to: null,
};
const snapshot = { ...marker, description: "", data: { large: "document" } };
const classSnapshot = {
	...marker,
	id: 3,
	hubuum_class_id: undefined,
	validate_schema: true,
	json_schema: {},
};
const relations = {
	at,
	coverage: "retained_history",
	relations: [
		{
			...marker,
			kind: "object",
			context_at: at,
			relation: { from_hubuum_object_id: 12, to_hubuum_object_id: 20 },
			from: { status: "unavailable", reason: "history_unavailable" },
			to: { status: "unavailable", reason: "history_unavailable" },
		},
	],
};
const population = {
	at,
	coverage: "retained_history",
	class: classSnapshot,
	objects: [snapshot],
};
const computed = {
	at,
	mode: "historical_recomputation",
	object: { class_id: 3, object_id: 12, history_id: 41 },
	shared: { status: "unavailable", reason: "definition_history_unavailable" },
	personal: "unsupported",
};

function respond(data: unknown, status = 200, headers = {}) {
	const fetch = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify(data), { status, headers }));
	vi.stubGlobal("fetch", fetch);
	return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("lightweight timeline API", () => {
	it.each([scope, { type: "class", classId: 3 } as const])(
		"uses a scoped BFF timeline with the original anchor, direction and cursor",
		async (resource) => {
			const fetch = respond(
				[resource.type === "object" ? marker : classSnapshot],
				200,
				{ "X-Next-Cursor": "next" },
			);
			const page = await fetchHistoryTimeline(resource, {
				anchor: 99,
				direction: "newer",
				cursor: "opaque",
				include_total: true,
			});
			const [path, options] = fetch.mock.calls[0];
			const url = new URL(path, "http://localhost");
			expect(url.pathname).toBe(
				`/_hubuum-bff/hubuum/api/v1/classes/3${resource.type === "object" ? "/12" : ""}/history/timeline`,
			);
			expect(Object.fromEntries(url.searchParams)).toEqual({
				anchor: "99",
				direction: "newer",
				cursor: "opaque",
				include_total: "false",
				limit: "25",
			});
			expect(options.credentials).toBe("include");
			expect(page.nextCursor).toBe("next");
		},
	);
	it("preserves exact seek timestamps", async () => {
		const fetch = respond([]);
		await fetchHistoryTimeline(scope, { at, direction: "older" });
		expect(
			new URL(fetch.mock.calls[0][0], "http://localhost").searchParams.get(
				"at",
			),
		).toBe(at);
	});
	it("retrieves a tombstone directly without using as-of or live data", async () => {
		const fetch = respond({ ...snapshot, op: "D", valid_to: at });
		expect((await fetchHistoryEntry(scope, 41)).op).toBe("D");
		expect(fetch.mock.calls[0][0]).toContain("/3/12/history/entries/41");
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it.each([
		{ ...snapshot, id: 99 },
		{ ...snapshot, hubuum_class_id: 99 },
		{ ...snapshot, history_id: 99 },
		{ ...snapshot, valid_from: "invalid" },
	])("rejects mismatched exact versions", async (value) => {
		respond(value);
		await expect(fetchHistoryEntry(scope, 41)).rejects.toThrow();
	});
	it.each([403, 404, 405, 500])(
		"does not fall back after status %i",
		async (status) => {
			const fetch = respond({}, status);
			await expect(fetchHistoryEntry(scope, 41)).rejects.toThrow();
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);
});

describe("historical context API", () => {
	it("requests bounded paginated relationships at the exact selected instant", async () => {
		const fetch = respond(relations, 200, { "X-Next-Cursor": "next" });
		expect(
			(await fetchHistoricalRelations(scope, at, "cursor")).nextCursor,
		).toBe("next");
		const url = new URL(fetch.mock.calls[0][0], "http://localhost");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			at,
			cursor: "cursor",
			include_total: "false",
			limit: "25",
		});
	});
	it("keeps retained population and historical computation semantics", async () => {
		respond(population);
		expect((await fetchHistoricalPopulation(3, at)).items).toEqual([snapshot]);
		respond(computed);
		expect((await fetchHistoricalComputed(scope, at, 41)).shared.status).toBe(
			"unavailable",
		);
	});
	it.each([
		{ ...relations, at: "2020-01-01T00:00:00Z" },
		{
			...relations,
			relations: [
				{
					...relations.relations[0],
					relation: { from_hubuum_object_id: 99, to_hubuum_object_id: 20 },
				},
			],
		},
		{ ...relations, relations: [{ ...relations.relations[0], valid_to: at }] },
	])(
		"rejects relationships at another time or outside the root",
		async (value) => {
			respond(value);
			await expect(fetchHistoricalRelations(scope, at)).rejects.toThrow();
		},
	);
	it.each([
		{ ...population, class: { ...classSnapshot, id: 99 } },
		{ ...population, objects: [{ ...snapshot, hubuum_class_id: 99 }] },
		{ ...population, objects: [{ ...snapshot, op: "D" }] },
		{ ...population, coverage: "complete" },
	])("rejects populations with mismatched context", async (value) => {
		respond(value);
		await expect(fetchHistoricalPopulation(3, at)).rejects.toThrow();
	});
	it("rejects a computed response for a different object version", async () => {
		respond({ ...computed, object: { ...computed.object, history_id: 42 } });
		await expect(fetchHistoricalComputed(scope, at, 41)).rejects.toThrow();
	});
	it.each([403, 404, 405, 500])(
		"never substitutes live context on status %i",
		async (status) => {
			const fetch = respond({}, status);
			await expect(fetchHistoricalRelations(scope, at)).rejects.toThrow();
			await expect(fetchHistoricalPopulation(3, at)).rejects.toThrow();
			await expect(fetchHistoricalComputed(scope, at, 41)).rejects.toThrow();
			expect(fetch).toHaveBeenCalledTimes(3);
		},
	);
});
