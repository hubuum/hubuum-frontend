import { describe, expect, it } from "vitest";

import {
	buildFrontendSettingsMergePatch,
	HUBUUM_FRONTEND_SETTINGS_NAMESPACE,
	InvalidFrontendSettingsDocumentError,
	readFrontendSettingsDocument,
} from "@/lib/user-settings-document";
import {
	DEVICE_SETTING_KEYS,
	PORTABLE_USER_SETTING_KEYS,
	USER_SETTINGS_SCHEMA_VERSION,
} from "@/lib/user-settings-types";

describe("principal settings document adapter", () => {
	it("reads only the versioned frontend namespace", () => {
		expect(
			readFrontendSettingsDocument({
				cli: { output: "json" },
				[HUBUUM_FRONTEND_SETTINGS_NAMESPACE]: {
					schema_version: USER_SETTINGS_SCHEMA_VERSION,
					preferences: {
						[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
						[DEVICE_SETTING_KEYS.sidebarCollapsed]: "1",
						unknown: "ignored",
					},
				},
			}),
		).toEqual({ [PORTABLE_USER_SETTING_KEYS.theme]: "dark" });
	});

	it("distinguishes an unused namespace from an invalid namespace", () => {
		expect(readFrontendSettingsDocument({ cli: {} })).toBeNull();
		expect(() =>
			readFrontendSettingsDocument({
				[HUBUUM_FRONTEND_SETTINGS_NAMESPACE]: {
					schema_version: USER_SETTINGS_SCHEMA_VERSION + 1,
					preferences: {},
				},
			}),
		).toThrow(InvalidFrontendSettingsDocumentError);
	});

	it("builds a recursive merge patch without touching other clients", () => {
		expect(
			buildFrontendSettingsMergePatch({
				[PORTABLE_USER_SETTING_KEYS.theme]: "light",
				[PORTABLE_USER_SETTING_KEYS.accent]: null,
			}),
		).toEqual({
			[HUBUUM_FRONTEND_SETTINGS_NAMESPACE]: {
				schema_version: USER_SETTINGS_SCHEMA_VERSION,
				preferences: {
					[PORTABLE_USER_SETTING_KEYS.theme]: "light",
					[PORTABLE_USER_SETTING_KEYS.accent]: null,
				},
			},
		});
	});
});
