import { afterEach, expect, it, vi } from "vitest";
import {
	anonymizeUser,
	clearLoginLimits,
	savePrincipalSettings,
} from "@/lib/api/admin-security";
afterEach(() => vi.unstubAllGlobals());
it("uses the reviewed settings revision and JSON Patch media type", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValue(
			new Response('{"revision":4,"settings":{}}', {
				headers: { ETag: '"settings-4"' },
			}),
		);
	vi.stubGlobal("fetch", fetch);
	await savePrincipalSettings(
		8,
		'"settings-3"',
		"patch",
		'[{"op":"remove","path":"/x"}]',
	);
	expect(fetch).toHaveBeenCalledWith(
		"/_hubuum-bff/hubuum/api/v1/iam/principals/8/settings",
		expect.objectContaining({
			method: "PATCH",
			credentials: "include",
			headers: {
				"If-Match": '"settings-3"',
				"Content-Type": "application/json-patch+json",
			},
		}),
	);
});
it("refetches settings after a 204 reset and rejects revision conflicts without retry", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(null, { status: 204 }))
		.mockResolvedValueOnce(
			new Response('{"revision":5,"settings":{}}', {
				headers: { ETag: '"settings-5"' },
			}),
		)
		.mockResolvedValueOnce(
			new Response('{"message":"Revision conflict"}', { status: 412 }),
		);
	vi.stubGlobal("fetch", fetch);
	expect(
		await savePrincipalSettings(8, '"settings-4"', "reset", ""),
	).toMatchObject({ revision: 5, settings: {} });
	await expect(
		savePrincipalSettings(8, '"settings-4"', "merge", "{}"),
	).rejects.toThrow("Revision conflict");
	expect(fetch).toHaveBeenCalledTimes(3);
});
it("protects anonymization with If-Match and encodes opaque rate-limit IDs", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(null, { status: 204 }))
		.mockResolvedValueOnce(new Response('{"released":true}'));
	vi.stubGlobal("fetch", fetch);
	await anonymizeUser(8, '"user-2"');
	await clearLoginLimits("opaque/id");
	expect(fetch.mock.calls[0][1].headers).toEqual({ "If-Match": '"user-2"' });
	expect(fetch.mock.calls[1][0]).toContain("opaque%2Fid");
});
