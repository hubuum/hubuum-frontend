import "server-only";

import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";

export type SessionPayload = {
	token: string;
	username?: string;
	createdAt: number;
	lastSeen: number;
};

interface SessionStore {
	create(sid: string, payload: SessionPayload): Promise<void>;
	get(sid: string): Promise<SessionPayload | null>;
	touch(sid: string, payload: SessionPayload): Promise<void>;
	destroy(sid: string): Promise<void>;
}

class ValkeySessionStore implements SessionStore {
	constructor(
		private readonly ttlSeconds: number,
		private readonly prefix: string,
	) {}

	private key(sid: string): string {
		return `${this.prefix}${sid}`;
	}

	async create(sid: string, payload: SessionPayload): Promise<void> {
		const client = getValkeyClient();
		await client.set(
			this.key(sid),
			JSON.stringify(payload),
			"EX",
			this.ttlSeconds,
		);
	}

	async get(sid: string): Promise<SessionPayload | null> {
		const client = getValkeyClient();
		const raw = await client.get(this.key(sid));
		if (!raw) {
			return null;
		}

		try {
			return JSON.parse(raw) as SessionPayload;
		} catch {
			return null;
		}
	}

	async touch(sid: string, payload: SessionPayload): Promise<void> {
		const client = getValkeyClient();
		await client.set(
			this.key(sid),
			JSON.stringify(payload),
			"EX",
			this.ttlSeconds,
		);
	}

	async destroy(sid: string): Promise<void> {
		await getValkeyClient().del(this.key(sid));
	}
}

let store: SessionStore | null = null;

export function getSessionStore(): SessionStore {
	if (store) {
		return store;
	}

	const env = getServerEnv();
	store = new ValkeySessionStore(env.SESSION_TTL_SECONDS, env.SESSION_PREFIX);
	return store;
}
