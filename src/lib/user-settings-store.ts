import "server-only";

import { getServerEnv } from "@/lib/env";
import {
	UserSettingsLimitError,
	type UserSettingsStore,
} from "@/lib/user-settings-store-core";
import { getValkeyClient } from "@/lib/valkey";
import {
	MAX_USER_SETTINGS,
	type UserSettings,
} from "@/lib/user-settings-types";

export {
	InMemoryUserSettingsStore,
	UserSettingsLimitError,
	type UserSettingsStore,
} from "@/lib/user-settings-store-core";

const PATCH_SETTINGS_SCRIPT = `
local projected = redis.call("HLEN", KEYS[1])
for index = 2, #ARGV, 3 do
  local field = ARGV[index]
  local operation = ARGV[index + 1]
  local exists = redis.call("HEXISTS", KEYS[1], field)
  if operation == "delete" then
    if exists == 1 then projected = projected - 1 end
  elseif exists == 0 then
    projected = projected + 1
  end
end
if projected > tonumber(ARGV[1]) then return 0 end
for index = 2, #ARGV, 3 do
  local field = ARGV[index]
  local operation = ARGV[index + 1]
  if operation == "delete" then
    redis.call("HDEL", KEYS[1], field)
  else
    redis.call("HSET", KEYS[1], field, ARGV[index + 2])
  end
end
return 1
`;

class ValkeyUserSettingsStore implements UserSettingsStore {
	constructor(private readonly prefix: string) {}

	private userKey(principalId: number): string {
		return `${this.prefix}user:${principalId}`;
	}

	private client() {
		return getValkeyClient();
	}

	async getUserSettings(principalId: number): Promise<UserSettings> {
		return this.client().hgetall(this.userKey(principalId));
	}

	async patchUserSettings(
		principalId: number,
		updates: Record<string, string | null>,
	): Promise<UserSettings> {
		const client = this.client();
		const key = this.userKey(principalId);
		const argumentsList: string[] = [String(MAX_USER_SETTINGS)];
		for (const [settingKey, value] of Object.entries(updates)) {
			argumentsList.push(
				settingKey,
				value === null ? "delete" : "set",
				value ?? "",
			);
		}
		const applied = await client.eval(
			PATCH_SETTINGS_SCRIPT,
			1,
			key,
			...argumentsList,
		);
		if (Number(applied) !== 1) throw new UserSettingsLimitError();
		return client.hgetall(key);
	}
}

let store: UserSettingsStore | null = null;

export function getUserSettingsStore(): UserSettingsStore {
	if (store) return store;

	const env = getServerEnv();
	store = new ValkeyUserSettingsStore(env.SETTINGS_PREFIX);
	return store;
}
