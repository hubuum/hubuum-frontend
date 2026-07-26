import "server-only";

import { getServerEnv } from "@/lib/env";
import type { TemplateReportRunStore } from "@/lib/template-report-run-store-core";
import { getValkeyClient } from "@/lib/valkey";

export {
	InMemoryTemplateReportRunStore,
	type TemplateReportRunStore,
} from "@/lib/template-report-run-store-core";

const DELETE_IF_MATCHES_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

class ValkeyTemplateReportRunStore implements TemplateReportRunStore {
	constructor(
		private readonly prefix: string,
		private readonly ttlSeconds: number,
	) {}

	private taskKey(key: string): string {
		return `${this.prefix}report-run:${key}`;
	}

	private lockKey(key: string): string {
		return `${this.taskKey(key)}:lock`;
	}

	async getTaskId(key: string): Promise<number | null> {
		const raw = await getValkeyClient().get(this.taskKey(key));
		if (!raw || !/^[1-9]\d*$/.test(raw)) {
			return null;
		}

		const parsed = Number.parseInt(raw, 10);
		return Number.isSafeInteger(parsed) ? parsed : null;
	}

	async setTaskId(key: string, taskId: number): Promise<void> {
		await getValkeyClient().set(
			this.taskKey(key),
			String(taskId),
			"EX",
			this.ttlSeconds,
		);
	}

	async deleteTaskId(key: string, expectedTaskId: number): Promise<void> {
		await getValkeyClient().eval(
			DELETE_IF_MATCHES_SCRIPT,
			1,
			this.taskKey(key),
			String(expectedTaskId),
		);
	}

	async tryAcquireLock(
		key: string,
		owner: string,
		ttlMilliseconds: number,
	): Promise<boolean> {
		const result = await getValkeyClient().set(
			this.lockKey(key),
			owner,
			"PX",
			ttlMilliseconds,
			"NX",
		);
		return result === "OK";
	}

	async releaseLock(key: string, owner: string): Promise<void> {
		await getValkeyClient().eval(
			DELETE_IF_MATCHES_SCRIPT,
			1,
			this.lockKey(key),
			owner,
		);
	}
}

let store: TemplateReportRunStore | null = null;

export function getTemplateReportRunStore(): TemplateReportRunStore {
	if (store) {
		return store;
	}

	const env = getServerEnv();
	store = new ValkeyTemplateReportRunStore(
		env.SESSION_PREFIX,
		env.SESSION_TTL_SECONDS,
	);
	return store;
}
