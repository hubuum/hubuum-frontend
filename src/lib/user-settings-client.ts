"use client";

import {
	isRetryableSettingsError,
	patchUserSettings,
	UserSettingsTransportError,
} from "@/lib/user-settings-transport";
import {
	DEVICE_SETTING_KEYS,
	isDeviceSettingKey,
	isUserSettingKey,
	MAX_USER_SETTING_VALUE_LENGTH,
	normalizeUserSettingUpdates,
	PORTABLE_USER_SETTING_KEYS,
	USER_SETTINGS_CACHE_VERSION_KEY,
	USER_SETTINGS_OWNER_KEY,
	USER_SETTINGS_PENDING_KEY_PREFIX,
	USER_SETTINGS_SCHEMA_VERSION,
	type UserSettingsSnapshot,
} from "@/lib/user-settings-types";

export const USER_SETTINGS_QUERY_KEY = ["user-settings"] as const;
export const USER_SETTINGS_CHANGED_EVENT = "hubuum:user-settings-changed";
export const USER_SETTINGS_SYNC_STATUS_EVENT =
	"hubuum:user-settings-sync-status";

export type UserSettingsSyncStatus =
	| "disabled"
	| "idle"
	| "syncing"
	| "synced"
	| "degraded";

const FLUSH_DEBOUNCE_MS = 250;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

let activePrincipalId: number | null = null;
let syncEnabled = false;
let syncStatus: UserSettingsSyncStatus = "disabled";
let flushTimer: number | null = null;
let flushInFlight: Promise<void> | null = null;
let retryAttempt = 0;
const pendingUpdates = new Map<string, string | null>();

function listPortableSettingKeys(): string[] {
	const keys: string[] = [];
	for (let index = 0; index < window.localStorage.length; index += 1) {
		const key = window.localStorage.key(index);
		if (key && isUserSettingKey(key)) keys.push(key);
	}
	return keys;
}

function clearPortableSettingValues(): void {
	for (const key of listPortableSettingKeys()) {
		window.localStorage.removeItem(key);
	}
}

function pendingStorageKey(principalId: number): string {
	return `${USER_SETTINGS_PENDING_KEY_PREFIX}${principalId}`;
}

function readPersistedPendingUpdates(
	principalId: number,
): Record<string, string | null> {
	try {
		const raw = window.localStorage.getItem(pendingStorageKey(principalId));
		if (!raw) return {};
		return normalizeUserSettingUpdates(JSON.parse(raw)) ?? {};
	} catch {
		return {};
	}
}

function persistPendingUpdates(): void {
	if (activePrincipalId === null) return;
	try {
		const key = pendingStorageKey(activePrincipalId);
		if (pendingUpdates.size === 0) {
			window.localStorage.removeItem(key);
			return;
		}
		window.localStorage.setItem(
			key,
			JSON.stringify(Object.fromEntries(pendingUpdates)),
		);
	} catch {
		// The in-memory queue still gives this tab a chance to retry.
	}
}

function applyUpdatesToCache(updates: Record<string, string | null>): void {
	for (const [key, value] of Object.entries(updates)) {
		if (!isUserSettingKey(key)) continue;
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, value);
	}
}

function setSyncStatus(status: UserSettingsSyncStatus): void {
	if (syncStatus === status) return;
	syncStatus = status;
	window.dispatchEvent(
		new CustomEvent(USER_SETTINGS_SYNC_STATUS_EVENT, { detail: { status } }),
	);
}

export function getUserSettingsSyncStatus(): UserSettingsSyncStatus {
	return syncStatus;
}

export function isUserSettingsSyncInitialized(): boolean {
	return syncEnabled;
}

export function markUserSettingsSyncDegraded(): void {
	if (typeof window !== "undefined") setSyncStatus("degraded");
}

export function prepareUserSettingsCache(principalId: number | null): void {
	if (typeof window === "undefined") return;
	const owner = window.localStorage.getItem(USER_SETTINGS_OWNER_KEY);
	const nextOwner = principalId === null ? null : String(principalId);
	const cacheVersion = window.localStorage.getItem(
		USER_SETTINGS_CACHE_VERSION_KEY,
	);
	const hasIncompatibleCache =
		cacheVersion !== null &&
		cacheVersion !== String(USER_SETTINGS_SCHEMA_VERSION);

	if (nextOwner === null || owner !== nextOwner || hasIncompatibleCache) {
		clearPortableSettingValues();
	}
	if (nextOwner === null || owner !== nextOwner) {
		window.localStorage.removeItem(DEVICE_SETTING_KEYS.recentItems);
	}

	pendingUpdates.clear();
	activePrincipalId = principalId;
	syncEnabled = false;
	retryAttempt = 0;
	if (principalId === null) {
		window.localStorage.removeItem(USER_SETTINGS_OWNER_KEY);
		window.localStorage.removeItem(USER_SETTINGS_CACHE_VERSION_KEY);
		setSyncStatus("disabled");
		return;
	}

	window.localStorage.setItem(USER_SETTINGS_OWNER_KEY, String(principalId));
	window.localStorage.setItem(
		USER_SETTINGS_CACHE_VERSION_KEY,
		String(USER_SETTINGS_SCHEMA_VERSION),
	);
	const persisted = readPersistedPendingUpdates(principalId);
	for (const [key, value] of Object.entries(persisted)) {
		pendingUpdates.set(key, value);
	}
	applyUpdatesToCache(persisted);
	setSyncStatus("idle");
}

export function initializeUserSettings(snapshot: UserSettingsSnapshot): void {
	if (typeof window === "undefined") return;
	if (syncEnabled && activePrincipalId === snapshot.principalId) return;

	const owner = window.localStorage.getItem(USER_SETTINGS_OWNER_KEY);
	const principalOwner = String(snapshot.principalId);
	const migration: Record<string, string> = {};
	if (owner === null) {
		for (const key of listPortableSettingKeys()) {
			if (snapshot.settings[key] !== undefined) continue;
			const value = window.localStorage.getItem(key);
			if (value !== null) migration[key] = value;
		}
	}

	const persisted = readPersistedPendingUpdates(snapshot.principalId);
	clearPortableSettingValues();
	applyUpdatesToCache(
		Object.fromEntries(
			Object.entries(snapshot.settings).filter(([key]) =>
				isUserSettingKey(key),
			),
		),
	);
	applyUpdatesToCache(migration);
	applyUpdatesToCache(persisted);
	window.localStorage.setItem(USER_SETTINGS_OWNER_KEY, principalOwner);
	window.localStorage.setItem(
		USER_SETTINGS_CACHE_VERSION_KEY,
		String(USER_SETTINGS_SCHEMA_VERSION),
	);

	activePrincipalId = snapshot.principalId;
	syncEnabled = true;
	retryAttempt = 0;
	pendingUpdates.clear();
	for (const [key, value] of Object.entries({ ...migration, ...persisted })) {
		pendingUpdates.set(key, value);
	}
	persistPendingUpdates();
	setSyncStatus(pendingUpdates.size > 0 ? "idle" : "synced");
	if (pendingUpdates.size > 0) scheduleFlush();
}

export function disableUserSettingsSync(): void {
	syncEnabled = false;
	activePrincipalId = null;
	if (flushTimer !== null) window.clearTimeout(flushTimer);
	flushTimer = null;
	pendingUpdates.clear();
	retryAttempt = 0;
	setSyncStatus("disabled");
}

export function clearUserSettingsForLogout(): void {
	if (typeof window === "undefined") return;
	const accent = window.localStorage.getItem(PORTABLE_USER_SETTING_KEYS.accent);
	const secondaryAccent = window.localStorage.getItem(
		PORTABLE_USER_SETTING_KEYS.secondaryAccent,
	);
	if (accent === null) {
		window.localStorage.removeItem(DEVICE_SETTING_KEYS.loginAccent);
	} else {
		window.localStorage.setItem(DEVICE_SETTING_KEYS.loginAccent, accent);
	}
	if (secondaryAccent === null) {
		window.localStorage.removeItem(DEVICE_SETTING_KEYS.loginSecondaryAccent);
	} else {
		window.localStorage.setItem(
			DEVICE_SETTING_KEYS.loginSecondaryAccent,
			secondaryAccent,
		);
	}
	disableUserSettingsSync();
	clearPortableSettingValues();
	window.localStorage.removeItem(DEVICE_SETTING_KEYS.recentItems);
	window.localStorage.removeItem(USER_SETTINGS_OWNER_KEY);
	window.localStorage.removeItem(USER_SETTINGS_CACHE_VERSION_KEY);
}

function scheduleFlush(delayMs = FLUSH_DEBOUNCE_MS): void {
	if (!syncEnabled || flushTimer !== null) return;
	flushTimer = window.setTimeout(() => {
		flushTimer = null;
		void flushUserSettings();
	}, delayMs);
}

function mergeFailedUpdates(updates: Record<string, string | null>): void {
	for (const [key, value] of Object.entries(updates)) {
		if (!pendingUpdates.has(key)) pendingUpdates.set(key, value);
	}
}

export function flushUserSettings(
	options: { keepalive?: boolean } = {},
): Promise<void> {
	if (flushInFlight) {
		return flushInFlight.then(() =>
			pendingUpdates.size > 0 ? flushUserSettings(options) : undefined,
		);
	}
	if (!syncEnabled || activePrincipalId === null || pendingUpdates.size === 0) {
		return Promise.resolve();
	}

	if (flushTimer !== null) {
		window.clearTimeout(flushTimer);
		flushTimer = null;
	}
	const principalId = activePrincipalId;
	const updates = Object.fromEntries(pendingUpdates);
	pendingUpdates.clear();
	setSyncStatus("syncing");

	flushInFlight = patchUserSettings(updates, options)
		.then(() => {
			if (!syncEnabled || activePrincipalId !== principalId) return;
			retryAttempt = 0;
			persistPendingUpdates();
			setSyncStatus(pendingUpdates.size > 0 ? "idle" : "synced");
		})
		.catch((error: unknown) => {
			if (!syncEnabled || activePrincipalId !== principalId) return;
			const retryable = isRetryableSettingsError(error);
			const preserveForNextSession =
				error instanceof UserSettingsTransportError &&
				(error.status === 401 || error.status === 403);
			if (retryable || preserveForNextSession) {
				mergeFailedUpdates(updates);
			}
			persistPendingUpdates();
			setSyncStatus("degraded");
			if (retryable) {
				retryAttempt += 1;
				const retryDelay = Math.min(
					RETRY_MAX_MS,
					RETRY_BASE_MS * 2 ** (retryAttempt - 1),
				);
				scheduleFlush(retryDelay);
			}
		})
		.finally(() => {
			flushInFlight = null;
			if (
				syncEnabled &&
				activePrincipalId === principalId &&
				pendingUpdates.size > 0 &&
				flushTimer === null &&
				syncStatus !== "degraded"
			) {
				scheduleFlush(0);
			}
		});

	return flushInFlight;
}

function announceSettingChange(key: string): void {
	window.dispatchEvent(
		new CustomEvent(USER_SETTINGS_CHANGED_EVENT, { detail: { key } }),
	);
}

export function writeUserSetting(key: string, value: string): boolean {
	if (
		typeof window === "undefined" ||
		!isUserSettingKey(key) ||
		value.length > MAX_USER_SETTING_VALUE_LENGTH
	) {
		return false;
	}
	try {
		if (window.localStorage.getItem(key) === value) return true;
		window.localStorage.setItem(key, value);
		if (activePrincipalId !== null) {
			pendingUpdates.set(key, value);
			persistPendingUpdates();
			if (syncEnabled) {
				setSyncStatus("idle");
				scheduleFlush();
			}
		}
		announceSettingChange(key);
		return true;
	} catch {
		return false;
	}
}

export function removeUserSetting(key: string): boolean {
	if (typeof window === "undefined" || !isUserSettingKey(key)) return false;
	try {
		if (window.localStorage.getItem(key) === null) return true;
		window.localStorage.removeItem(key);
		if (activePrincipalId !== null) {
			pendingUpdates.set(key, null);
			persistPendingUpdates();
			if (syncEnabled) {
				setSyncStatus("idle");
				scheduleFlush();
			}
		}
		announceSettingChange(key);
		return true;
	} catch {
		return false;
	}
}

export function writeDeviceSetting(key: string, value: string): boolean {
	if (typeof window === "undefined" || !isDeviceSettingKey(key)) return false;
	try {
		if (window.localStorage.getItem(key) === value) return true;
		window.localStorage.setItem(key, value);
		announceSettingChange(key);
		return true;
	} catch {
		return false;
	}
}

export function removeDeviceSetting(key: string): boolean {
	if (typeof window === "undefined" || !isDeviceSettingKey(key)) return false;
	try {
		if (window.localStorage.getItem(key) === null) return true;
		window.localStorage.removeItem(key);
		announceSettingChange(key);
		return true;
	} catch {
		return false;
	}
}

export function resetUserSettingsSyncForTests(): void {
	if (typeof window !== "undefined" && flushTimer !== null) {
		window.clearTimeout(flushTimer);
	}
	activePrincipalId = null;
	syncEnabled = false;
	syncStatus = "disabled";
	flushTimer = null;
	flushInFlight = null;
	retryAttempt = 0;
	pendingUpdates.clear();
}
