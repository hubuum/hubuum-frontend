import { describe, expect, it } from "vitest";

import {
	DEVICE_SETTING_KEYS,
	getUserSettingScope,
	normalizeUserSettingsSnapshot,
	normalizeUserSettingUpdates,
	PORTABLE_USER_SETTING_KEYS,
	USER_SETTINGS_SCHEMA_VERSION,
} from "@/lib/user-settings-types";

describe("user settings validation", () => {
	it("accepts only registered portable setting keys", () => {
		expect(
			normalizeUserSettingUpdates({
				[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
				[PORTABLE_USER_SETTING_KEYS.secondaryAccent]: "rose",
				[PORTABLE_USER_SETTING_KEYS.objectDataColumns(4)]: null,
				[PORTABLE_USER_SETTING_KEYS.objectHiddenComputedColumns(4)]: "[]",
			}),
		).toEqual({
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
			[PORTABLE_USER_SETTING_KEYS.secondaryAccent]: "rose",
			[PORTABLE_USER_SETTING_KEYS.objectDataColumns(4)]: null,
			[PORTABLE_USER_SETTING_KEYS.objectHiddenComputedColumns(4)]: "[]",
		});
	});

	it("rejects internal, unknown, device-local, and non-string values", () => {
		expect(normalizeUserSettingUpdates({ theme: "dark" })).toBeNull();
		expect(
			normalizeUserSettingUpdates({ "hubuum.settings.owner": "12" }),
		).toBeNull();
		expect(
			normalizeUserSettingUpdates({
				[DEVICE_SETTING_KEYS.tableWidths("objects")]: "{}",
			}),
		).toBeNull();
		expect(
			normalizeUserSettingUpdates({ [PORTABLE_USER_SETTING_KEYS.theme]: true }),
		).toBeNull();
	});

	it("classifies portable and device-local settings", () => {
		expect(getUserSettingScope(PORTABLE_USER_SETTING_KEYS.pinnedItems)).toBe(
			"portable",
		);
		expect(
			getUserSettingScope(PORTABLE_USER_SETTING_KEYS.objectCustomDataFields(9)),
		).toBe("portable");
		expect(
			getUserSettingScope(
				PORTABLE_USER_SETTING_KEYS.objectHiddenComputedColumns(9),
			),
		).toBe("portable");
		expect(getUserSettingScope(DEVICE_SETTING_KEYS.sidebarCollapsed)).toBe(
			"device",
		);
		expect(getUserSettingScope(DEVICE_SETTING_KEYS.loginAccent)).toBe("device");
		expect(getUserSettingScope(DEVICE_SETTING_KEYS.loginSecondaryAccent)).toBe(
			"device",
		);
		expect(getUserSettingScope(DEVICE_SETTING_KEYS.tasksLastSeenAt(9))).toBe(
			"device",
		);
		expect(getUserSettingScope("hubuum.future-unknown-setting")).toBeNull();
	});

	it("normalizes a versioned snapshot", () => {
		expect(
			normalizeUserSettingsSnapshot({
				schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
				principalId: 7,
				settings: { [PORTABLE_USER_SETTING_KEYS.density]: "compact" },
			}),
		).toEqual({
			schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
			principalId: 7,
			settings: { [PORTABLE_USER_SETTING_KEYS.density]: "compact" },
		});
		expect(
			normalizeUserSettingsSnapshot({
				schemaVersion: 2,
				principalId: 7,
				settings: {},
			}),
		).toBeNull();
	});
});
