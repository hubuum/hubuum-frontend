import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";
import {
	buildFrontendSettingsMergePatch,
	readFrontendSettingsDocument,
} from "@/lib/user-settings-document";
import { getUserSettingsStore } from "@/lib/user-settings-store";
import {
	filterPortableUserSettings,
	isUserSettingKey,
	USER_SETTINGS_SCHEMA_VERSION,
	type UserSettings,
	type UserSettingsSnapshot,
} from "@/lib/user-settings-types";

const BACKEND_SELF_SETTINGS_PATH = "/api/v1/iam/me/settings";

type SettingsRequestContext = {
	principalId: number;
	token: string;
	correlationId?: string;
};

type ResolvedSettings = {
	transport: "backend" | "fallback";
	settings: UserSettings;
};

export class UserSettingsServerError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "UserSettingsServerError";
	}
}

function snapshot(
	principalId: number,
	settings: UserSettings,
): UserSettingsSnapshot {
	return {
		schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
		principalId,
		settings,
	};
}

async function readBackendDocument(response: Response): Promise<unknown> {
	return response.json().catch(() => {
		throw new UserSettingsServerError(
			"The backend returned an invalid principal settings document.",
			502,
		);
	});
}

async function loadFallbackSettings(
	principalId: number,
): Promise<UserSettings> {
	const store = getUserSettingsStore();
	const storedSettings = await store.getUserSettings(principalId);
	const staleKeys = Object.keys(storedSettings).filter(
		(key) => !isUserSettingKey(key),
	);
	if (staleKeys.length > 0) {
		await store.patchUserSettings(
			principalId,
			Object.fromEntries(staleKeys.map((key) => [key, null])),
		);
	}
	return filterPortableUserSettings(storedSettings);
}

async function clearFallbackSettings(
	principalId: number,
	settings: UserSettings,
): Promise<void> {
	const keys = Object.keys(settings);
	if (keys.length === 0) return;
	await getUserSettingsStore().patchUserSettings(
		principalId,
		Object.fromEntries(keys.map((key) => [key, null])),
	);
}

async function patchBackendSettings(
	context: SettingsRequestContext,
	updates: Record<string, string | null>,
): Promise<UserSettings> {
	const response = await backendFetchRaw(BACKEND_SELF_SETTINGS_PATH, {
		method: "PATCH",
		token: context.token,
		correlationId: context.correlationId,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(buildFrontendSettingsMergePatch(updates)),
	});
	if (response.status !== 200) {
		throw new UserSettingsServerError(
			"The backend could not update principal settings.",
			response.status,
		);
	}
	const settings = readFrontendSettingsDocument(
		await readBackendDocument(response),
	);
	if (!settings) {
		throw new UserSettingsServerError(
			"The backend omitted the Hubuum frontend settings namespace after an update.",
			502,
		);
	}
	return settings;
}

async function resolveSettingsTransport(
	context: SettingsRequestContext,
): Promise<ResolvedSettings> {
	const response = await backendFetchRaw(BACKEND_SELF_SETTINGS_PATH, {
		method: "GET",
		token: context.token,
		correlationId: context.correlationId,
	});
	if (response.status === 404) {
		return {
			transport: "fallback",
			settings: await loadFallbackSettings(context.principalId),
		};
	}
	if (response.status !== 200) {
		throw new UserSettingsServerError(
			"The backend could not load principal settings.",
			response.status,
		);
	}

	const backendSettings = readFrontendSettingsDocument(
		await readBackendDocument(response),
	);
	if (backendSettings) {
		return { transport: "backend", settings: backendSettings };
	}

	const fallbackSettings = await loadFallbackSettings(context.principalId);
	if (Object.keys(fallbackSettings).length === 0) {
		return { transport: "backend", settings: {} };
	}

	const migratedSettings = await patchBackendSettings(
		context,
		fallbackSettings,
	);
	await clearFallbackSettings(context.principalId, fallbackSettings);
	return { transport: "backend", settings: migratedSettings };
}

export async function loadUserSettingsSnapshotForPrincipal(
	context: SettingsRequestContext,
): Promise<UserSettingsSnapshot> {
	const resolved = await resolveSettingsTransport(context);
	return snapshot(context.principalId, resolved.settings);
}

export async function patchUserSettingsForPrincipal(
	context: SettingsRequestContext,
	updates: Record<string, string | null>,
): Promise<UserSettingsSnapshot> {
	const resolved = await resolveSettingsTransport(context);
	const settings =
		resolved.transport === "backend"
			? await patchBackendSettings(context, updates)
			: await getUserSettingsStore().patchUserSettings(
					context.principalId,
					updates,
				);
	return snapshot(context.principalId, filterPortableUserSettings(settings));
}
