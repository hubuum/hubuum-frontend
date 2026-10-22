import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTokenActivity } from "@/lib/api/token-activity";

afterEach(() => vi.unstubAllGlobals());

describe("credential activity requests", () => {
	it("uses the principal-scoped BFF endpoint and preserves pagination and missing evidence", async () => {
		const payload = {
			creation: null,
			session_id: "session-family",
			sources: [],
			offset: 50,
			limit: 50,
			total: 52,
			next_offset: 52,
			collection_enabled: false,
			best_effort: true,
			retention_days: 30,
			source_cap: 64,
			overflow_since: "2026-10-22T10:00:00Z",
		};
		const fetch = vi.fn().mockResolvedValue(Response.json(payload));
		vi.stubGlobal("fetch", fetch);
		const { signal } = new AbortController();
		await expect(fetchTokenActivity(7, 42, 50, signal)).resolves.toEqual(
			payload,
		);
		expect(fetch).toHaveBeenCalledWith(
			"/_hubuum-bff/hubuum/api/v1/iam/principals/7/tokens/42/activity?offset=50&limit=50",
			{ method: "GET", credentials: "include", cache: "no-store", signal },
		);
	});

	it("keeps missing or hidden activity distinct from an empty source history", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({}, { status: 404 })),
		);
		await expect(fetchTokenActivity(7, 42, 0)).rejects.toThrow(
			"The token may have been removed or access is no longer allowed.",
		);
	});

	it.each([403, 500])(
		"surfaces a %s error without treating it as activity",
		async (status) => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValue(
						Response.json({ message: "Activity request rejected" }, { status }),
					),
			);
			await expect(fetchTokenActivity(7, 42, 0)).rejects.toThrow(
				"Activity request rejected",
			);
		},
	);
});
