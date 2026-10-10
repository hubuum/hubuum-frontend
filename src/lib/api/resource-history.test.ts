import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchResourceHistoryAsOf,
	fetchResourceHistoryPage,
} from "@/lib/api/events";
import {
	fetchHistoryLiveResource,
	restoreObjectSnapshot,
} from "@/lib/api/resource-history";
import type { HubuumObject } from "@/lib/api/generated/models";

const scope = { type: "object" as const, classId: 3, objectId: 12 };
const object: HubuumObject = {
	id: 12,
	hubuum_class_id: 3,
	collection_id: 4,
	name: "server",
	description: "",
	data: { network: { mtu: 9000, added: true }, unrelated: 1 },
	revision: 5,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-10-01T00:00:00Z",
};
const reviewed = { object, fields: {}, etag: '"object:12:5"', revision: 5 };
afterEach(() => vi.unstubAllGlobals());

describe("history API boundary", () => {
	it("uses the BFF, requests no total and retains exact as-of timestamps", async () => {
		const fetch = vi
			.fn()
			.mockImplementation(
				async () =>
					new Response("[]", { headers: { "X-Next-Cursor": "opaque" } }),
			);
		vi.stubGlobal("fetch", fetch);
		expect((await fetchResourceHistoryPage(scope)).nextCursor).toBe("opaque");
		expect(fetch.mock.calls[0][0]).toContain(
			"/_hubuum-bff/hubuum/api/v1/classes/3/12/history?",
		);
		expect(fetch.mock.calls[0][0]).toContain("include_total=false");
		await fetchResourceHistoryAsOf(scope, "2026-09-24T08:42:13.830219Z");
		expect(
			new URL(fetch.mock.calls[1][0], "http://localhost").searchParams.get(
				"at",
			),
		).toBe("2026-09-24T08:42:13.830219Z");
	});
	it("fetches an unexpanded live point and captures its ETag", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify(object), {
					headers: { ETag: reviewed.etag },
				}),
			);
		vi.stubGlobal("fetch", fetch);
		expect(await fetchHistoryLiveResource(scope)).toMatchObject({
			etag: reviewed.etag,
			revision: 5,
			object,
		});
		expect(fetch.mock.calls[0][0]).not.toContain("include=computed");
	});
	it("uses the reviewed validator and guards all reviewed data before restoring a subtree", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify(object)));
		vi.stubGlobal("fetch", fetch);
		await restoreObjectSnapshot(
			scope,
			reviewed,
			{ network: { mtu: 1500 }, unrelated: 2 },
			["/network"],
		);
		const [url, request] = fetch.mock.calls[0];
		expect(url).toBe("/_hubuum-bff/hubuum/api/v1/classes/3/12/data");
		expect(request.headers).toMatchObject({
			"If-Match": reviewed.etag,
			"Content-Type": "application/json-patch+json",
		});
		expect(JSON.parse(request.body)).toEqual([
			{ op: "test", path: "", value: object.data },
			{
				op: "replace",
				path: "",
				value: { network: { mtu: 1500 }, unrelated: 1 },
			},
		]);
	});
	it.each([409, 412])("does not retry a %i conflict", async (status) => {
		const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
		vi.stubGlobal("fetch", fetch);
		await expect(
			restoreObjectSnapshot(scope, reviewed, {}, [""]),
		).rejects.toThrow("Nothing was restored");
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("keeps the document guard when ETags are unavailable and does not write a no-op", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify(object)));
		vi.stubGlobal("fetch", fetch);
		await restoreObjectSnapshot(scope, { ...reviewed, etag: null }, {}, [""]);
		expect(fetch.mock.calls[0][1].headers).not.toHaveProperty("If-Match");
		expect(JSON.parse(fetch.mock.calls[0][1].body)[0].op).toBe("test");
		await restoreObjectSnapshot(scope, reviewed, object.data, []);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it.each([403, 422])(
		"reports permission/validation failures (%i) without retries",
		async (status) => {
			const fetch = vi
				.fn()
				.mockResolvedValue(
					new Response('{"message":"Restore rejected"}', { status }),
				);
			vi.stubGlobal("fetch", fetch);
			await expect(
				restoreObjectSnapshot(scope, reviewed, {}, [""]),
			).rejects.toThrow("Restore rejected");
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);
});
