import { afterEach, describe, expect, it, vi } from "vitest";

import {
	loadUserSettingsSnapshot,
	patchUserSettings,
	UserSettingsTransportError,
} from "@/lib/user-settings-transport";
import {
	PORTABLE_USER_SETTING_KEYS,
	USER_SETTINGS_SCHEMA_VERSION,
} from "@/lib/user-settings-types";

describe("user settings transport", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("validates snapshots at the transport boundary", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
						principalId: 7,
						settings: { [PORTABLE_USER_SETTING_KEYS.theme]: "dark" },
					}),
					{ status: 200 },
				),
			),
		);

		await expect(loadUserSettingsSnapshot()).resolves.toEqual({
			schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
			principalId: 7,
			settings: { [PORTABLE_USER_SETTING_KEYS.theme]: "dark" },
		});
	});

	it("rejects malformed successful responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ principalId: 7, settings: {} }), {
					status: 200,
				}),
			),
		);

		await expect(loadUserSettingsSnapshot()).rejects.toBeInstanceOf(
			UserSettingsTransportError,
		);
	});

	it("forwards lifecycle keepalive and preserves server error status", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ message: "Unavailable" }), {
				status: 503,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const error = await patchUserSettings(
			{ [PORTABLE_USER_SETTING_KEYS.theme]: "light" },
			{ keepalive: true },
		).catch((reason: unknown) => reason);

		expect(fetchMock).toHaveBeenCalledWith(
			"/_hubuum-bff/settings",
			expect.objectContaining({ keepalive: true, method: "PATCH" }),
		);
		expect(error).toBeInstanceOf(UserSettingsTransportError);
		expect((error as UserSettingsTransportError).status).toBe(503);
	});
});
