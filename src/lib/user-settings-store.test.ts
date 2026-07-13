import { describe, expect, it } from "vitest";

import {
	InMemoryUserSettingsStore,
	UserSettingsLimitError,
} from "@/lib/user-settings-store-core";
import {
	MAX_USER_SETTINGS,
	PORTABLE_USER_SETTING_KEYS,
} from "@/lib/user-settings-types";

describe("in-memory user settings store", () => {
	it("patches and deletes settings without affecting another principal", async () => {
		const store = new InMemoryUserSettingsStore();
		await store.patchUserSettings(1, {
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
		});
		await store.patchUserSettings(2, {
			[PORTABLE_USER_SETTING_KEYS.theme]: "light",
		});

		expect(
			await store.patchUserSettings(1, {
				[PORTABLE_USER_SETTING_KEYS.theme]: null,
			}),
		).toEqual({});
		expect(await store.getUserSettings(2)).toEqual({
			[PORTABLE_USER_SETTING_KEYS.theme]: "light",
		});
	});

	it("enforces the final per-principal setting limit", async () => {
		const store = new InMemoryUserSettingsStore();
		const settings = Object.fromEntries(
			Array.from({ length: MAX_USER_SETTINGS }, (_, index) => [
				PORTABLE_USER_SETTING_KEYS.objectDataColumns(index + 1),
				"[]",
			]),
		);
		await store.patchUserSettings(1, settings);

		await expect(
			store.patchUserSettings(1, {
				[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
			}),
		).rejects.toBeInstanceOf(UserSettingsLimitError);
		expect(Object.keys(await store.getUserSettings(1))).toHaveLength(
			MAX_USER_SETTINGS,
		);
	});
});
