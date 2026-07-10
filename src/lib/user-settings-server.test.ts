import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/backend", () => ({ backendFetchRaw: vi.fn() }));
vi.mock("@/lib/user-settings-store", () => ({
	getUserSettingsStore: vi.fn(),
	UserSettingsLimitError: class extends Error {},
}));

import { backendFetchRaw } from "@/lib/api/backend";
import {
	loadUserSettingsSnapshotForPrincipal,
	patchUserSettingsForPrincipal,
} from "@/lib/user-settings-server";
import { getUserSettingsStore } from "@/lib/user-settings-store";
import { HUBUUM_FRONTEND_SETTINGS_NAMESPACE } from "@/lib/user-settings-document";
import {
	PORTABLE_USER_SETTING_KEYS,
	USER_SETTINGS_SCHEMA_VERSION,
} from "@/lib/user-settings-types";

const context = {
	principalId: 7,
	token: "secret-token",
	correlationId: "test-correlation",
};

function backendDocument(settings: Record<string, string>) {
	return {
		cli: { output: "json" },
		[HUBUUM_FRONTEND_SETTINGS_NAMESPACE]: {
			schema_version: USER_SETTINGS_SCHEMA_VERSION,
			preferences: settings,
		},
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("server settings transport selection", () => {
	const store = {
		getUserSettings: vi.fn(),
		patchUserSettings: vi.fn(),
	};

	beforeEach(() => {
		vi.mocked(backendFetchRaw).mockReset();
		store.getUserSettings.mockReset();
		store.patchUserSettings.mockReset();
		vi.mocked(getUserSettingsStore).mockReturnValue(store);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses the temporary store while the backend route is absent", async () => {
		vi.mocked(backendFetchRaw).mockResolvedValueOnce(jsonResponse({}, 404));
		store.getUserSettings.mockResolvedValueOnce({
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
		});

		await expect(
			loadUserSettingsSnapshotForPrincipal(context),
		).resolves.toEqual({
			schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
			principalId: 7,
			settings: { [PORTABLE_USER_SETTING_KEYS.theme]: "dark" },
		});
	});

	it("uses the backend namespace without reading temporary storage", async () => {
		vi.mocked(backendFetchRaw).mockResolvedValueOnce(
			jsonResponse(
				backendDocument({ [PORTABLE_USER_SETTING_KEYS.density]: "compact" }),
			),
		);

		await expect(
			loadUserSettingsSnapshotForPrincipal(context),
		).resolves.toEqual({
			schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
			principalId: 7,
			settings: { [PORTABLE_USER_SETTING_KEYS.density]: "compact" },
		});
		expect(store.getUserSettings).not.toHaveBeenCalled();
	});

	it("migrates temporary settings when the backend namespace is empty", async () => {
		vi.mocked(backendFetchRaw)
			.mockResolvedValueOnce(jsonResponse({ cli: { output: "json" } }))
			.mockResolvedValueOnce(
				jsonResponse(
					backendDocument({ [PORTABLE_USER_SETTING_KEYS.theme]: "dark" }),
				),
			);
		store.getUserSettings.mockResolvedValueOnce({
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
		});
		store.patchUserSettings.mockResolvedValueOnce({});

		await loadUserSettingsSnapshotForPrincipal(context);

		expect(backendFetchRaw).toHaveBeenNthCalledWith(
			2,
			"/api/v1/iam/me/settings",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({
					[HUBUUM_FRONTEND_SETTINGS_NAMESPACE]: {
						schema_version: USER_SETTINGS_SCHEMA_VERSION,
						preferences: {
							[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
						},
					},
				}),
			}),
		);
		expect(store.patchUserSettings).toHaveBeenCalledWith(7, {
			[PORTABLE_USER_SETTING_KEYS.theme]: null,
		});
	});

	it("patches the backend with JSON Merge Patch semantics", async () => {
		vi.mocked(backendFetchRaw)
			.mockResolvedValueOnce(jsonResponse(backendDocument({})))
			.mockResolvedValueOnce(
				jsonResponse(
					backendDocument({ [PORTABLE_USER_SETTING_KEYS.theme]: "light" }),
				),
			);

		await expect(
			patchUserSettingsForPrincipal(context, {
				[PORTABLE_USER_SETTING_KEYS.theme]: "light",
				[PORTABLE_USER_SETTING_KEYS.accent]: null,
			}),
		).resolves.toEqual({
			schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
			principalId: 7,
			settings: { [PORTABLE_USER_SETTING_KEYS.theme]: "light" },
		});
	});

	it("patches temporary storage when the backend route is absent", async () => {
		vi.mocked(backendFetchRaw).mockResolvedValueOnce(jsonResponse({}, 404));
		store.getUserSettings.mockResolvedValueOnce({});
		store.patchUserSettings.mockResolvedValueOnce({
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
		});

		await patchUserSettingsForPrincipal(context, {
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
		});

		expect(store.patchUserSettings).toHaveBeenLastCalledWith(7, {
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
		});
	});
});
