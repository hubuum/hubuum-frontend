import { afterEach, expect, it, vi } from "vitest";
import {
	fetchConfigurationHistory,
	fetchConfigurationSnapshot,
} from "@/lib/api/configuration-history";
afterEach(() => vi.unstubAllGlobals());
it.each(["remote_target", "export_template"] as const)(
	"retains cursors and exact timestamps for %s",
	async (kind) => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response('[{"history_id":51}]', {
					headers: { "X-Next-Cursor": "older" },
				}),
			)
			.mockResolvedValueOnce(new Response('{"history_id":1}'));
		vi.stubGlobal("fetch", fetch);
		expect(await fetchConfigurationHistory(kind, 7, "previous")).toEqual({
			items: [{ history_id: 51 }],
			nextCursor: "older",
		});
		const query = new URL(fetch.mock.calls[0][0], "http://localhost")
			.searchParams;
		expect(query.get("cursor")).toBe("previous");
		expect(query.get("include_total")).toBe("false");
		expect(query.get("sort")).toBe("-history_id");
		await fetchConfigurationSnapshot(
			kind,
			7,
			"2026-10-01T12:00:00.123456789+02:00",
		);
		expect(
			new URL(fetch.mock.calls[1][0], "http://localhost").searchParams.get(
				"at",
			),
		).toBe("2026-10-01T12:00:00.123456789+02:00");
	},
);
it("distinguishes no snapshot from request failure and validates timestamps", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response("{}", { status: 404 }))
		.mockResolvedValueOnce(
			new Response('{"message":"Forbidden"}', { status: 403 }),
		);
	vi.stubGlobal("fetch", fetch);
	await expect(
		fetchConfigurationSnapshot("remote_target", 7, "invalid"),
	).rejects.toThrow("RFC3339");
	expect(fetch).not.toHaveBeenCalled();
	expect(
		await fetchConfigurationSnapshot(
			"remote_target",
			7,
			"2026-10-01T12:00:00Z",
		),
	).toBeNull();
	await expect(
		fetchConfigurationSnapshot("remote_target", 7, "2026-10-01T12:00:00Z"),
	).rejects.toThrow("Forbidden");
});
