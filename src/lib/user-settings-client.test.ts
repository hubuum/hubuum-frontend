import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/user-settings-transport", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/user-settings-transport")>();
	return {
		...original,
		patchUserSettings: vi.fn(),
	};
});

import {
	clearUserSettingsForLogout,
	flushUserSettings,
	getUserSettingsSyncStatus,
	initializeUserSettings,
	prepareUserSettingsCache,
	resetUserSettingsSyncForTests,
	writeDeviceSetting,
	writeUserSetting,
} from "@/lib/user-settings-client";
import {
	patchUserSettings,
	UserSettingsTransportError,
} from "@/lib/user-settings-transport";
import {
	DEVICE_SETTING_KEYS,
	PORTABLE_USER_SETTING_KEYS,
	USER_SETTINGS_OWNER_KEY,
	USER_SETTINGS_PENDING_KEY_PREFIX,
	USER_SETTINGS_SCHEMA_VERSION,
} from "@/lib/user-settings-types";

type StorageDouble = ReturnType<typeof createLocalStorage>;

function createLocalStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		get length() {
			return store.size;
		},
		key: vi.fn((index: number) => [...store.keys()][index] ?? null),
		getItem: vi.fn((key: string) => store.get(key) ?? null),
		removeItem: vi.fn((key: string) => {
			store.delete(key);
		}),
		setItem: vi.fn((key: string, value: string) => {
			store.set(key, value);
		}),
		entries: () => Object.fromEntries(store),
	};
}

function installWindow(localStorage: StorageDouble) {
	vi.stubGlobal("window", {
		localStorage,
		setTimeout: globalThis.setTimeout,
		clearTimeout: globalThis.clearTimeout,
		dispatchEvent: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
	vi.stubGlobal(
		"CustomEvent",
		class<T> {
			constructor(
				readonly type: string,
				readonly init?: { detail?: T },
			) {}

			get detail() {
				return this.init?.detail;
			}
		},
	);
}

function snapshot(principalId: number, settings: Record<string, string> = {}) {
	return {
		schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
		principalId,
		settings,
	} as const;
}

describe("user settings synchronization", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(patchUserSettings).mockReset();
	});

	afterEach(() => {
		resetUserSettingsSyncForTests();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("migrates portable legacy values but leaves device state local", () => {
		const storage = createLocalStorage({
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
			[DEVICE_SETTING_KEYS.tableWidths("objects")]: '{"name":240}',
		});
		installWindow(storage);

		initializeUserSettings(snapshot(7));

		expect(storage.getItem(PORTABLE_USER_SETTING_KEYS.theme)).toBe("dark");
		expect(storage.getItem(DEVICE_SETTING_KEYS.tableWidths("objects"))).toBe(
			'{"name":240}',
		);
		expect(
			JSON.parse(
				storage.getItem(`${USER_SETTINGS_PENDING_KEY_PREFIX}7`) ?? "{}",
			),
		).toEqual({ [PORTABLE_USER_SETTING_KEYS.theme]: "dark" });
	});

	it("quarantines account data while preserving non-sensitive device state", () => {
		const storage = createLocalStorage({
			[USER_SETTINGS_OWNER_KEY]: "1",
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
			[DEVICE_SETTING_KEYS.recentItems]: "[]",
			[DEVICE_SETTING_KEYS.tableWidths("objects")]: '{"name":240}',
			[`${USER_SETTINGS_PENDING_KEY_PREFIX}2`]: JSON.stringify({
				[PORTABLE_USER_SETTING_KEYS.accent]: "violet",
			}),
		});
		installWindow(storage);

		prepareUserSettingsCache(2);

		expect(storage.getItem(PORTABLE_USER_SETTING_KEYS.theme)).toBeNull();
		expect(storage.getItem(PORTABLE_USER_SETTING_KEYS.accent)).toBe("violet");
		expect(storage.getItem(DEVICE_SETTING_KEYS.recentItems)).toBeNull();
		expect(storage.getItem(DEVICE_SETTING_KEYS.tableWidths("objects"))).toBe(
			'{"name":240}',
		);
		expect(storage.getItem(USER_SETTINGS_OWNER_KEY)).toBe("2");
	});

	it("retries transient failures and clears the durable override after snapshot confirmation", async () => {
		const storage = createLocalStorage();
		installWindow(storage);
		vi.mocked(patchUserSettings)
			.mockRejectedValueOnce(new UserSettingsTransportError("offline", null))
			.mockResolvedValueOnce();
		initializeUserSettings(snapshot(7));

		expect(writeUserSetting(PORTABLE_USER_SETTING_KEYS.theme, "dark")).toBe(
			true,
		);
		await vi.advanceTimersByTimeAsync(250);
		expect(patchUserSettings).toHaveBeenCalledTimes(1);
		expect(getUserSettingsSyncStatus()).toBe("degraded");
		expect(
			storage.getItem(`${USER_SETTINGS_PENDING_KEY_PREFIX}7`),
		).not.toBeNull();

		await vi.advanceTimersByTimeAsync(1_000);
		expect(patchUserSettings).toHaveBeenCalledTimes(2);
		expect(getUserSettingsSyncStatus()).toBe("synced");
		expect(
			JSON.parse(
				storage.getItem(`${USER_SETTINGS_PENDING_KEY_PREFIX}7`) ?? "{}",
			),
		).toEqual({ [PORTABLE_USER_SETTING_KEYS.theme]: "dark" });

		resetUserSettingsSyncForTests();
		initializeUserSettings(
			snapshot(7, { [PORTABLE_USER_SETTING_KEYS.theme]: "dark" }),
		);

		expect(storage.getItem(`${USER_SETTINGS_PENDING_KEY_PREFIX}7`)).toBeNull();
	});

	it("keeps a locally saved accent when a refresh receives a stale snapshot", async () => {
		const storage = createLocalStorage();
		installWindow(storage);
		vi.mocked(patchUserSettings).mockResolvedValue();
		initializeUserSettings(
			snapshot(7, { [PORTABLE_USER_SETTING_KEYS.accent]: "teal" }),
		);

		writeUserSetting(PORTABLE_USER_SETTING_KEYS.accent, "violet");
		await flushUserSettings();
		expect(getUserSettingsSyncStatus()).toBe("synced");

		resetUserSettingsSyncForTests();
		initializeUserSettings(
			snapshot(7, { [PORTABLE_USER_SETTING_KEYS.accent]: "teal" }),
		);

		expect(storage.getItem(PORTABLE_USER_SETTING_KEYS.accent)).toBe("violet");
		expect(
			JSON.parse(
				storage.getItem(`${USER_SETTINGS_PENDING_KEY_PREFIX}7`) ?? "{}",
			),
		).toEqual({ [PORTABLE_USER_SETTING_KEYS.accent]: "violet" });
		expect(getUserSettingsSyncStatus()).toBe("idle");

		await vi.advanceTimersByTimeAsync(250);
		expect(patchUserSettings).toHaveBeenLastCalledWith(
			{ [PORTABLE_USER_SETTING_KEYS.accent]: "violet" },
			{},
		);
	});

	it("keeps a newer write when an older in-flight write fails", async () => {
		const storage = createLocalStorage();
		installWindow(storage);
		let rejectFirst!: (reason?: unknown) => void;
		vi.mocked(patchUserSettings)
			.mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						rejectFirst = reject;
					}),
			)
			.mockResolvedValueOnce();
		initializeUserSettings(snapshot(7));
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.theme, "dark");
		const firstFlush = flushUserSettings();
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.theme, "light");
		rejectFirst(new UserSettingsTransportError("offline", null));
		await firstFlush;

		await vi.advanceTimersByTimeAsync(1_000);
		expect(patchUserSettings).toHaveBeenLastCalledWith(
			{ [PORTABLE_USER_SETTING_KEYS.theme]: "light" },
			{},
		);
	});

	it("uses keepalive for an explicit lifecycle flush", async () => {
		const storage = createLocalStorage();
		installWindow(storage);
		vi.mocked(patchUserSettings).mockResolvedValueOnce();
		initializeUserSettings(snapshot(7));
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.density, "compact");

		await flushUserSettings({ keepalive: true });

		expect(patchUserSettings).toHaveBeenCalledWith(
			{ [PORTABLE_USER_SETTING_KEYS.density]: "compact" },
			{ keepalive: true },
		);
	});

	it("does not enqueue device-local settings", async () => {
		const storage = createLocalStorage();
		installWindow(storage);
		initializeUserSettings(snapshot(7));

		expect(writeDeviceSetting(DEVICE_SETTING_KEYS.sidebarCollapsed, "1")).toBe(
			true,
		);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(patchUserSettings).not.toHaveBeenCalled();
	});

	it("keeps the chosen accent as an anonymous login-page hint on logout", () => {
		const storage = createLocalStorage({
			[USER_SETTINGS_OWNER_KEY]: "7",
			[PORTABLE_USER_SETTING_KEYS.accent]: "violet",
			[PORTABLE_USER_SETTING_KEYS.secondaryAccent]: "amber",
			[PORTABLE_USER_SETTING_KEYS.theme]: "dark",
			[DEVICE_SETTING_KEYS.recentItems]: "[]",
		});
		installWindow(storage);

		clearUserSettingsForLogout();

		expect(storage.getItem(PORTABLE_USER_SETTING_KEYS.accent)).toBeNull();
		expect(
			storage.getItem(PORTABLE_USER_SETTING_KEYS.secondaryAccent),
		).toBeNull();
		expect(storage.getItem(PORTABLE_USER_SETTING_KEYS.theme)).toBeNull();
		expect(storage.getItem(DEVICE_SETTING_KEYS.loginAccent)).toBe("violet");
		expect(storage.getItem(DEVICE_SETTING_KEYS.loginSecondaryAccent)).toBe(
			"amber",
		);
		expect(storage.getItem(DEVICE_SETTING_KEYS.recentItems)).toBeNull();
		expect(storage.getItem(USER_SETTINGS_OWNER_KEY)).toBeNull();
	});

	it("keeps user changes durable while the initial settings load is unavailable", () => {
		const storage = createLocalStorage({
			[USER_SETTINGS_OWNER_KEY]: "7",
		});
		installWindow(storage);
		prepareUserSettingsCache(7);

		expect(writeUserSetting(PORTABLE_USER_SETTING_KEYS.theme, "dark")).toBe(
			true,
		);

		expect(
			JSON.parse(
				storage.getItem(`${USER_SETTINGS_PENDING_KEY_PREFIX}7`) ?? "{}",
			),
		).toEqual({ [PORTABLE_USER_SETTING_KEYS.theme]: "dark" });
		expect(patchUserSettings).not.toHaveBeenCalled();
	});

	it("reports localStorage write failures", () => {
		const storage = createLocalStorage();
		storage.setItem.mockImplementation(() => {
			throw new Error("quota exceeded");
		});
		installWindow(storage);

		expect(writeUserSetting(PORTABLE_USER_SETTING_KEYS.theme, "dark")).toBe(
			false,
		);
	});
});
