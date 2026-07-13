import {
	MAX_USER_SETTINGS,
	type UserSettings,
} from "@/lib/user-settings-types";

export class UserSettingsLimitError extends Error {
	constructor() {
		super(`A user cannot store more than ${MAX_USER_SETTINGS} settings.`);
		this.name = "UserSettingsLimitError";
	}
}

export interface UserSettingsStore {
	getUserSettings(principalId: number): Promise<UserSettings>;
	patchUserSettings(
		principalId: number,
		updates: Record<string, string | null>,
	): Promise<UserSettings>;
}

export class InMemoryUserSettingsStore implements UserSettingsStore {
	private readonly users = new Map<number, UserSettings>();

	async getUserSettings(principalId: number): Promise<UserSettings> {
		return { ...(this.users.get(principalId) ?? {}) };
	}

	async patchUserSettings(
		principalId: number,
		updates: Record<string, string | null>,
	): Promise<UserSettings> {
		const next = { ...(this.users.get(principalId) ?? {}) };
		for (const [key, value] of Object.entries(updates)) {
			if (value === null) {
				delete next[key];
			} else {
				next[key] = value;
			}
		}
		if (Object.keys(next).length > MAX_USER_SETTINGS) {
			throw new UserSettingsLimitError();
		}
		this.users.set(principalId, next);
		return { ...next };
	}
}
