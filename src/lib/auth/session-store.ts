import "server-only";

import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";
import {
	sessionPayloadSchema,
	sessionTtlSeconds,
	type SessionPayload,
} from "./session-credentials";

export type { SessionPayload } from "./session-credentials";

export interface SessionStore {
	create(sid: string, payload: SessionPayload): Promise<void>;
	get(sid: string): Promise<SessionPayload | null>;
	touch(sid: string, payload: SessionPayload): Promise<boolean>;
	claimRefresh(
		sid: string,
		generation: string,
		owner: string,
	): Promise<boolean>;
	completeRefresh(
		sid: string,
		generation: string,
		owner: string,
		payload: SessionPayload,
	): Promise<boolean>;
	invalidateGeneration(
		sid: string,
		generation: string,
		options?: { preserveRefresh?: boolean },
	): Promise<boolean>;
	destroy(sid: string): Promise<void>;
}

// A claim stays attached to the generation until commit or session destruction.
// It never expires back into a reusable refresh credential after a pod failure.
const CLAIM_REFRESH = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
if session.generation ~= ARGV[1] or session.refreshing then return 0 end
session.refreshing = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return 1
`;
const COMPLETE_REFRESH = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
if session.generation ~= ARGV[1] or session.refreshing ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
return 1
`;
const TOUCH = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
if session.generation ~= ARGV[1] or session.refreshing then return 0 end
session.lastSeen = math.max(session.lastSeen, tonumber(ARGV[2]))
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[3])
return 1
`;
const INVALIDATE_GENERATION = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
if session.generation == ARGV[1] and not (ARGV[2] == '1' and session.refreshing) then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class ValkeySessionStore implements SessionStore {
	constructor(
		private readonly ttlSeconds: number,
		private readonly prefix: string,
	) {}

	private key(sid: string): string {
		return `${this.prefix}${sid}`;
	}

	async create(sid: string, payload: SessionPayload): Promise<void> {
		const ttl = sessionTtlSeconds(payload, this.ttlSeconds);
		if (
			ttl < 1 ||
			(await getValkeyClient().set(
				this.key(sid),
				JSON.stringify(payload),
				"EX",
				ttl,
				"NX",
			)) !== "OK"
		) {
			throw new Error("Session could not be created");
		}
	}

	async get(sid: string): Promise<SessionPayload | null> {
		const raw = await getValkeyClient().get(this.key(sid));
		if (!raw) return null;
		try {
			const parsed = sessionPayloadSchema.safeParse(JSON.parse(raw));
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	}

	async touch(sid: string, payload: SessionPayload): Promise<boolean> {
		const ttl = sessionTtlSeconds(payload, this.ttlSeconds);
		if (ttl < 1) return false;
		return (
			(await getValkeyClient().eval(
				TOUCH,
				1,
				this.key(sid),
				payload.generation,
				payload.lastSeen,
				ttl,
			)) === 1
		);
	}

	async claimRefresh(
		sid: string,
		generation: string,
		owner: string,
	): Promise<boolean> {
		return (
			(await getValkeyClient().eval(
				CLAIM_REFRESH,
				1,
				this.key(sid),
				generation,
				owner,
			)) === 1
		);
	}

	async completeRefresh(
		sid: string,
		generation: string,
		owner: string,
		payload: SessionPayload,
	): Promise<boolean> {
		const ttl = sessionTtlSeconds(payload, this.ttlSeconds);
		if (ttl < 1) return false;
		return (
			(await getValkeyClient().eval(
				COMPLETE_REFRESH,
				1,
				this.key(sid),
				generation,
				owner,
				JSON.stringify(payload),
				ttl,
			)) === 1
		);
	}

	async invalidateGeneration(
		sid: string,
		generation: string,
		options: { preserveRefresh?: boolean } = {},
	): Promise<boolean> {
		return (
			(await getValkeyClient().eval(
				INVALIDATE_GENERATION,
				1,
				this.key(sid),
				generation,
				options.preserveRefresh ? "1" : "0",
			)) === 1
		);
	}

	async destroy(sid: string): Promise<void> {
		await getValkeyClient().del(this.key(sid));
	}
}

let store: SessionStore | null = null;
export function getSessionStore(): SessionStore {
	if (!store) {
		const env = getServerEnv();
		store = new ValkeySessionStore(env.SESSION_TTL_SECONDS, env.SESSION_PREFIX);
	}
	return store;
}
