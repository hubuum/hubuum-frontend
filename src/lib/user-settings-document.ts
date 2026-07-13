import {
	filterPortableUserSettings,
	USER_SETTINGS_SCHEMA_VERSION,
	type UserSettings,
} from "@/lib/user-settings-types";

export const HUBUUM_FRONTEND_SETTINGS_NAMESPACE = "hubuum_frontend";

type JsonObject = Record<string, unknown>;

export class InvalidFrontendSettingsDocumentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidFrontendSettingsDocumentError";
	}
}

function isJsonObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readFrontendSettingsDocument(
	document: unknown,
): UserSettings | null {
	if (!isJsonObject(document)) {
		throw new InvalidFrontendSettingsDocumentError(
			"Principal settings must be a JSON object.",
		);
	}

	const namespace = document[HUBUUM_FRONTEND_SETTINGS_NAMESPACE];
	if (namespace === undefined) return null;
	if (!isJsonObject(namespace)) {
		throw new InvalidFrontendSettingsDocumentError(
			"The Hubuum frontend settings namespace must be an object.",
		);
	}
	if (namespace.schema_version !== USER_SETTINGS_SCHEMA_VERSION) {
		throw new InvalidFrontendSettingsDocumentError(
			"The Hubuum frontend settings namespace uses an unsupported schema version.",
		);
	}
	if (!isJsonObject(namespace.preferences)) {
		throw new InvalidFrontendSettingsDocumentError(
			"The Hubuum frontend settings preferences must be an object.",
		);
	}

	const stringPreferences = Object.fromEntries(
		Object.entries(namespace.preferences).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
	return filterPortableUserSettings(stringPreferences);
}

export function buildFrontendSettingsMergePatch(
	updates: Record<string, string | null>,
): JsonObject {
	return {
		[HUBUUM_FRONTEND_SETTINGS_NAMESPACE]: {
			schema_version: USER_SETTINGS_SCHEMA_VERSION,
			preferences: updates,
		},
	};
}
