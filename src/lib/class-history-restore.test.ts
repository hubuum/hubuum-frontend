import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	HubuumClass,
	HubuumClassHistory,
} from "@/lib/api/generated/models";
import {
	fetchHistoryLiveResource,
	restoreClassSnapshot,
	reviewClassRestore,
} from "@/lib/api/resource-history";
import { buildClassRestore } from "@/lib/resource-history";

const live: HubuumClass = {
	id: 3,
	name: "Current",
	description: "Now",
	collection_id: 4,
	revision: 7,
	validate_schema: true,
	json_schema: { type: "object" },
	created_at: "",
	updated_at: "",
};
const source: HubuumClassHistory = {
	...live,
	name: "Historical",
	description: "",
	collection_id: 5,
	validate_schema: false,
	json_schema: null,
	history_id: 20,
	op: "UPDATE",
	valid_from: "2026-09-24T08:42:13.830219Z",
};
const reviewed = {
	classDefinition: live,
	fields: {},
	revision: 7,
	etag: '"class:3:7"',
};
afterEach(() => vi.unstubAllGlobals());

describe("class history restoration", () => {
	it("plans only explicitly selected metadata, including empty descriptions", () => {
		const plan = buildClassRestore(live, source, ["name", "description"]);
		expect(plan.patch).toEqual({ name: "Historical", description: "" });
		expect(plan.proposed.collection_id).toBe(4);
		expect(plan.changes.map((change) => change.path)).toEqual([
			"/description",
			"/name",
		]);
		expect(live.validate_schema).toBe(true);
	});
	it.each(["json_schema", "validate_schema", "id"])(
		"rejects unsupported %s restoration",
		(field) => {
			expect(() => buildClassRestore(live, source, [field])).toThrow(
				"additional server support",
			);
		},
	);
	it("rejects deleted or mismatched source snapshots", () => {
		expect(() =>
			buildClassRestore(live, { ...source, id: 99 }, ["name"]),
		).toThrow("source snapshot");
		expect(() =>
			buildClassRestore(live, { ...source, op: "DELETE" }, ["name"]),
		).toThrow("source snapshot");
	});
	it("captures a fresh class and validator without requiring grant provenance", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify(live), {
					headers: { etag: reviewed.etag },
				}),
			);
		vi.stubGlobal("fetch", fetch);
		expect(
			await fetchHistoryLiveResource({ type: "class", classId: 3 }),
		).toMatchObject(reviewed);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0][1]).toMatchObject({
			credentials: "include",
			cache: "no-store",
		});
	});
	it.each([null, 'W/"class:3:7"', "invalid"])(
		"blocks review and write without a strong validator (%s)",
		async (etag) => {
			const fetch = vi.fn();
			vi.stubGlobal("fetch", fetch);
			await expect(
				reviewClassRestore(3, { ...reviewed, etag }, source, ["name"]),
			).rejects.toThrow("strong revision validator");
			await expect(
				restoreClassSnapshot(3, { ...reviewed, etag }, source, ["name"]),
			).rejects.toThrow("strong revision validator");
			expect(fetch).not.toHaveBeenCalled();
		},
	);
	it("checks the selected destination and blocks the whole review when unavailable", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response("{}", { status: 404 }));
		vi.stubGlobal("fetch", fetch);
		await expect(
			reviewClassRestore(3, reviewed, source, ["name", "collection_id"]),
		).rejects.toThrow("No fields will be restored");
		expect(fetch.mock.calls[0][0]).toBe(
			"/_hubuum-bff/hubuum/api/v1/collections/5",
		);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("checks available destinations without making a write during review", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('{"id":5}'));
		vi.stubGlobal("fetch", fetch);
		expect(
			(await reviewClassRestore(3, reviewed, source, ["collection_id"])).patch,
		).toEqual({ collection_id: 5 });
		expect(fetch.mock.calls[0][1].method).toBe("GET");
	});
	it("sends all reviewed fields in one conditional write without grant provenance calls", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(live)));
		vi.stubGlobal("fetch", fetch);
		await restoreClassSnapshot(3, reviewed, source, [
			"name",
			"description",
			"collection_id",
		]);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, request] = fetch.mock.calls[0];
		expect(url).toBe("/_hubuum-bff/hubuum/api/v1/classes/3");
		expect(request.headers["If-Match"]).toBe(reviewed.etag);
		expect(JSON.parse(request.body)).toEqual({
			name: "Historical",
			description: "",
			collection_id: 5,
		});
	});
	it("does not write matching fields or an empty selection", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await restoreClassSnapshot(3, reviewed, source, []);
		await restoreClassSnapshot(3, reviewed, { ...source, name: live.name }, [
			"name",
		]);
		expect(fetch).not.toHaveBeenCalled();
	});
	it.each([403, 404, 409, 412, 422])(
		"never retries a rejected write (%i)",
		async (status) => {
			const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
			vi.stubGlobal("fetch", fetch);
			await expect(
				restoreClassSnapshot(3, reviewed, source, ["name"]),
			).rejects.toThrow();
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);
});
