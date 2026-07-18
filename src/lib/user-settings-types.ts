export const USER_SETTINGS_SCHEMA_VERSION = 1;
export const USER_SETTINGS_OWNER_KEY = "hubuum.settings.owner";
export const USER_SETTINGS_CACHE_VERSION_KEY = "hubuum.settings.cache-version";
export const USER_SETTINGS_PENDING_KEY_PREFIX = "hubuum.settings.pending.";
export const MAX_USER_SETTINGS = 250;
export const MAX_USER_SETTING_KEY_LENGTH = 160;
export const MAX_USER_SETTING_VALUE_LENGTH = 50_000;

export const PORTABLE_USER_SETTING_KEYS = {
	theme: "hubuum.theme",
	density: "hubuum.density",
	accent: "hubuum.accent",
	secondaryAccent: "hubuum.secondary-accent",
	pinnedItems: "hubuum.pinned-items",
	objectDataColumns: (classId: number) =>
		`hubuum.object-data-columns:${classId}`,
	objectHiddenComputedColumns: (classId: number) =>
		`hubuum.object-hidden-computed-columns:${classId}`,
	objectRawDataColumn: (classId: number) =>
		`hubuum.object-raw-data-column:${classId}`,
	objectCustomDataFields: (classId: number) =>
		`hubuum.object-custom-data-fields:${classId}:user`,
} as const;

export const DEVICE_SETTING_KEYS = {
	sidebarCollapsed: "hubuum.sidebar.collapsed",
	loginAccent: "hubuum.login.accent",
	loginSecondaryAccent: "hubuum.login.secondary-accent",
	recentItems: "hubuum.recent-items",
	tableWidths: (storageKey: string) => `hubuum.table.${storageKey}.widths`,
	tasksLastSeenAt: (principalId: number) =>
		`hubuum.tasks.lastSeenAt.${principalId}`,
} as const;

const EXACT_PORTABLE_KEYS = new Set<string>([
	PORTABLE_USER_SETTING_KEYS.theme,
	PORTABLE_USER_SETTING_KEYS.density,
	PORTABLE_USER_SETTING_KEYS.accent,
	PORTABLE_USER_SETTING_KEYS.secondaryAccent,
	PORTABLE_USER_SETTING_KEYS.pinnedItems,
]);

const PORTABLE_KEY_PATTERNS = [
	/^hubuum\.object-data-columns:[1-9]\d*$/,
	/^hubuum\.object-hidden-computed-columns:[1-9]\d*$/,
	/^hubuum\.object-raw-data-column:[1-9]\d*$/,
	/^hubuum\.object-custom-data-fields:[1-9]\d*:user$/,
];

const EXACT_DEVICE_KEYS = new Set<string>([
	DEVICE_SETTING_KEYS.sidebarCollapsed,
	DEVICE_SETTING_KEYS.loginAccent,
	DEVICE_SETTING_KEYS.loginSecondaryAccent,
	DEVICE_SETTING_KEYS.recentItems,
]);

const DEVICE_KEY_PATTERNS = [
	/^hubuum\.table\..+\.widths$/,
	/^hubuum\.tasks\.lastSeenAt\.[1-9]\d*$/,
];

export type UserSettings = Record<string, string>;

export type UserSettingsSnapshot = {
	schemaVersion: typeof USER_SETTINGS_SCHEMA_VERSION;
	principalId: number;
	settings: UserSettings;
};

export type UserSettingScope = "portable" | "device";

export function getUserSettingScope(key: string): UserSettingScope | null {
	if (!key || key.length > MAX_USER_SETTING_KEY_LENGTH) return null;
	if (
		EXACT_PORTABLE_KEYS.has(key) ||
		PORTABLE_KEY_PATTERNS.some((pattern) => pattern.test(key))
	) {
		return "portable";
	}
	if (
		EXACT_DEVICE_KEYS.has(key) ||
		DEVICE_KEY_PATTERNS.some((pattern) => pattern.test(key))
	) {
		return "device";
	}
	return null;
}

export function isUserSettingKey(key: string): boolean {
	return getUserSettingScope(key) === "portable";
}

export function isDeviceSettingKey(key: string): boolean {
	return getUserSettingScope(key) === "device";
}

export function normalizeUserSettingUpdates(
	value: unknown,
): Record<string, string | null> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const entries = Object.entries(value);
	if (entries.length > MAX_USER_SETTINGS) {
		return null;
	}

	const updates: Record<string, string | null> = {};
	for (const [key, settingValue] of entries) {
		if (
			!isUserSettingKey(key) ||
			(settingValue !== null &&
				(typeof settingValue !== "string" ||
					settingValue.length > MAX_USER_SETTING_VALUE_LENGTH))
		) {
			return null;
		}
		updates[key] = settingValue;
	}

	return updates;
}

export function normalizeUserSettingsSnapshot(
	value: unknown,
): UserSettingsSnapshot | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const snapshot = value as Record<string, unknown>;
	if (
		snapshot.schemaVersion !== USER_SETTINGS_SCHEMA_VERSION ||
		!Number.isInteger(snapshot.principalId) ||
		Number(snapshot.principalId) <= 0 ||
		!snapshot.settings ||
		typeof snapshot.settings !== "object" ||
		Array.isArray(snapshot.settings)
	) {
		return null;
	}

	const settings: UserSettings = {};
	for (const [key, settingValue] of Object.entries(snapshot.settings)) {
		if (
			!isUserSettingKey(key) ||
			typeof settingValue !== "string" ||
			settingValue.length > MAX_USER_SETTING_VALUE_LENGTH
		) {
			return null;
		}
		settings[key] = settingValue;
	}

	return {
		schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
		principalId: Number(snapshot.principalId),
		settings,
	};
}

export function filterPortableUserSettings(value: UserSettings): UserSettings {
	const settings: UserSettings = {};
	for (const [key, settingValue] of Object.entries(value)) {
		if (
			isUserSettingKey(key) &&
			typeof settingValue === "string" &&
			settingValue.length <= MAX_USER_SETTING_VALUE_LENGTH
		) {
			settings[key] = settingValue;
		}
	}
	return settings;
}
