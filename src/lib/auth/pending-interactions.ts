import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { BackendTarget } from "@/lib/backend-target";
import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";
import { normalizeReturnPath } from "@/lib/return-path";
import {
	AuthenticationError,
	cleanupInteraction,
	InteractionAccess,
	interactionRequest,
	providerIdSchema,
} from "./interactions-protocol";

const uuid = z.uuid();
const mutationSchema = z.object({
	method: z.enum(["POST", "PATCH"]),
	path: z.string().max(512),
	body: z.record(z.string(), z.unknown()),
	ifMatch: z.string().max(256).optional(),
	idempotencyKey: z.string().max(256).optional(),
});
const actorSchema = z.object({
	sid: uuid,
	sessionId: uuid,
	token: z.string().min(1).max(16384),
});
const intentSchema = z.discriminatedUnion("purpose", [
	z.object({ purpose: z.literal("login") }),
	z.object({
		purpose: z.literal("credential_approval"),
		actor: actorSchema,
		mutation: mutationSchema,
	}),
	z.object({
		purpose: z.literal("provider_verification"),
		actor: actorSchema,
		candidateId: uuid,
	}),
]);
export type InteractionIntent = z.infer<typeof intentSchema>;
const recordBase = z.object({
	id: uuid,
	providerId: providerIdSchema,
	redemption_secret: z.string().regex(/^hai1\.[0-9a-f]{64}$/),
	browserId: uuid,
	nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	target: z.object({
		origin: z.string().url(),
		revision: z.string().min(1).max(256),
	}),
	intent: intentSchema,
	returnPath: z
		.string()
		.startsWith("/")
		.max(4096)
		.refine((path) => normalizeReturnPath(path) === path),
	expiresAt: z.number().finite(),
	intervalSeconds: z.number().int().min(1).max(60),
	nextPollAt: z.number().finite(),
	pollOwner: uuid.optional(),
	pollUntil: z.number().finite().optional(),
});
const recordSchema = z.discriminatedUnion("state", [
	recordBase.extend({ state: z.literal("pending") }),
	recordBase.extend({
		state: z.literal("claimed"),
		owner: uuid,
		claimedAt: z.number().finite(),
	}),
]);
type PendingRecord = z.infer<typeof recordSchema>;
export type NewPendingInteraction = Omit<
	PendingRecord,
	"state" | "owner" | "claimedAt" | "nextPollAt" | "pollOwner" | "pollUntil"
>;

function key(id: string): string {
	return `${getServerEnv().SESSION_PREFIX}auth:interaction:${id}`;
}
function browserKey(id: string): string {
	return `${getServerEnv().SESSION_PREFIX}auth:browser:${id}`;
}
function indexKey(id: string): string {
	return `${getServerEnv().SESSION_PREFIX}auth:index:${id}`;
}
function cleanupKey(): string {
	return `${getServerEnv().SESSION_PREFIX}auth:cleanup`;
}
function sameNonce(a: string, b: string): boolean {
	const left = Buffer.from(a),
		right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

// The sorted set contains at most four live interactions for a browser. Both
// quota and record creation are atomic across frontend replicas.
const CREATE = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[2]) >= 4 then return 0 end
if not redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3], 'NX') then return 0 end
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])
redis.call('EXPIRE', KEYS[2], 601)
return 1
`;
const CLAIM = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.state ~= 'pending' or record.nonce ~= ARGV[1] or record.browserId ~= ARGV[2] then return 0 end
record.state = 'claimed'
record.owner = ARGV[3]
record.claimedAt = tonumber(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(record), 'PX', math.max(1, record.expiresAt + 3600000 - tonumber(ARGV[4])))
redis.call('ZADD', KEYS[2], tonumber(ARGV[4]) + 90000, record.id)
return 1
`;
const RECOVER = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
local now = tonumber(ARGV[3])
if record.state ~= 'claimed' or record.owner ~= ARGV[1] or record.claimedAt > now - 90000 then return 0 end
record.owner = ARGV[2]
record.claimedAt = now
redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
redis.call('ZADD', KEYS[2], now + 90000, record.id)
return 1
`;
const START_POLL = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
local now = tonumber(ARGV[1])
if record.state ~= 'pending' or record.nextPollAt > now or (record.pollUntil and record.pollUntil > now) then return 0 end
record.pollOwner = ARGV[2]
record.pollUntil = now + 31000
redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
return 1
`;
const END_POLL = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.state ~= 'pending' or record.pollOwner ~= ARGV[1] then return 0 end
record.nextPollAt = tonumber(ARGV[2])
record.pollOwner = nil
record.pollUntil = nil
redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
return 1
`;
const FINISH = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local pending = cjson.decode(raw)
if pending.state ~= 'claimed' or pending.owner ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', 300)
redis.call('ZREM', KEYS[2], ARGV[3])
redis.call('ZREM', KEYS[3], ARGV[3])
return 1
`;
const RESULT = `
local raw = redis.call('GET', KEYS[1])
if raw ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 1
`;

/** Anonymous browser identifiers are minted here, never adopted from user input. */
export async function anonymousInteractionBrowser(
	current?: string,
): Promise<string> {
	if (
		current &&
		uuid.safeParse(current).success &&
		(await getValkeyClient().get(browserKey(current)))
	)
		return current;
	const id = randomUUID();
	await getValkeyClient().set(browserKey(id), "1", "EX", 600, "NX");
	return id;
}

export async function createPendingInteraction(
	input: NewPendingInteraction,
): Promise<void> {
	const parsed = recordSchema.safeParse({
		...input,
		state: "pending",
		nextPollAt: Date.now() + input.intervalSeconds * 1000,
	});
	if (!parsed.success) throw new AuthenticationError("protocol_error");
	const record = parsed.data;
	const remaining = record.expiresAt - Date.now();
	const raw = JSON.stringify(record);
	if (
		remaining <= 0 ||
		remaining > 600_000 ||
		Buffer.byteLength(raw) > 96 * 1024
	)
		throw new AuthenticationError("protocol_error");
	const saved = await getValkeyClient().eval(
		CREATE,
		2,
		key(record.id),
		indexKey(record.browserId),
		Date.now(),
		raw,
		Math.max(1, Math.ceil(remaining / 1000)),
		record.expiresAt,
		record.id,
	);
	if (saved !== 1) throw new AuthenticationError("slow_down", 5);
}

export type InteractionOwner = {
	browserId: string;
	nonce: string;
	target: BackendTarget;
	sessionId?: string;
};

async function ownedPending(
	id: string,
	binding: InteractionOwner,
): Promise<PendingRecord> {
	if (
		!uuid.safeParse(id).success ||
		!uuid.safeParse(binding.browserId).success ||
		!/^[A-Za-z0-9_-]{43}$/.test(binding.nonce)
	)
		throw new AuthenticationError("interaction_invalid");
	const raw = await getValkeyClient().get(key(id));
	if (!raw) throw new AuthenticationError("interaction_invalid");
	let record: PendingRecord;
	try {
		record = recordSchema.parse(JSON.parse(raw));
	} catch {
		throw new AuthenticationError("interaction_invalid");
	}
	if (
		record.browserId !== binding.browserId ||
		!sameNonce(record.nonce, binding.nonce) ||
		record.target.origin !== binding.target.origin ||
		record.target.revision !== binding.target.revision ||
		(record.intent.purpose !== "login" &&
			(record.intent.actor.sid !== binding.browserId ||
				record.intent.actor.sessionId !== binding.sessionId))
	)
		throw new AuthenticationError("interaction_invalid");
	if (record.expiresAt <= Date.now())
		throw new AuthenticationError("interaction_expired");
	return record;
}

/** Atomic completion authority. Its private constructor follows ownership and
 * purpose checks plus a cross-replica compare-and-swap; callers cannot fabricate it. */
export class ClaimedInteraction {
	readonly #record: PendingRecord;
	readonly #owner: string;
	private constructor(record: PendingRecord, owner: string) {
		this.#record = record;
		this.#owner = owner;
	}
	static async acquire(
		id: string,
		binding: InteractionOwner,
	): Promise<ClaimedInteraction> {
		const record = await ownedPending(id, binding);
		if (record.state !== "pending")
			throw new AuthenticationError("interaction_consumed");
		const owner = randomUUID();
		if (
			(await getValkeyClient().eval(
				CLAIM,
				2,
				key(id),
				cleanupKey(),
				record.nonce,
				record.browserId,
				owner,
				Date.now(),
			)) !== 1
		)
			throw new AuthenticationError("interaction_consumed");
		return new ClaimedInteraction(record, owner);
	}
	get id(): string {
		return this.#record.id;
	}
	get browserId(): string {
		return this.#record.browserId;
	}
	get target(): BackendTarget {
		return { ...this.#record.target };
	}
	get intent(): InteractionIntent {
		return structuredClone(this.#record.intent);
	}
	get returnPath(): string {
		return this.#record.returnPath;
	}
	get providerId(): string {
		return this.#record.providerId;
	}
	get access(): InteractionAccess {
		const access = InteractionAccess.parse(this.#record);
		if (!access) throw new AuthenticationError("protocol_error");
		return access;
	}
	/** Finished records contain no redemption secret or captured actor credential.
	 * Result values stay private in Valkey until a separately bound result read. */
	async finish(browserId: string, result: unknown): Promise<void> {
		await finishRecord(this.#record, this.#owner, browserId, result);
	}
}

async function finishRecord(
	record: PendingRecord,
	owner: string,
	browserId: string,
	result: unknown,
): Promise<void> {
	const value = JSON.stringify({
		id: record.id,
		state: "finished",
		browserId,
		originalBrowserId: record.browserId,
		nonce: record.nonce,
		returnPath: record.returnPath,
		purpose: record.intent.purpose,
		loginAccepted:
			record.intent.purpose === "login" &&
			z.object({ authenticated: z.literal(true) }).safeParse(result).success,
		target: record.target,
		sessionId:
			record.intent.purpose === "login"
				? undefined
				: record.intent.actor.sessionId,
		result,
	});
	if (Buffer.byteLength(value) > 1024 * 1024)
		throw new AuthenticationError("protocol_error");
	if (
		(await getValkeyClient().eval(
			FINISH,
			3,
			key(record.id),
			indexKey(record.browserId),
			cleanupKey(),
			owner,
			value,
			record.id,
		)) !== 1
	)
		throw new AuthenticationError("interaction_consumed");
}

/** Recover at most eight abandoned claims. Claim transfer fences a delayed
 * handler before cleanup, and this path never invokes completion or a mutation. */
export async function recoverAbandonedInteractions(): Promise<{
	attempted: number;
	cleaned: number;
	unconfirmed: number;
}> {
	const due = await getValkeyClient().zrangebyscore(
		cleanupKey(),
		"-inf",
		Date.now(),
		"LIMIT",
		0,
		8,
	);
	const results = await Promise.all(
		due.map(async (id) => {
			const raw = await getValkeyClient().get(key(id));
			if (!raw) {
				await getValkeyClient().zrem(cleanupKey(), id);
				return "unconfirmed";
			}
			let record: PendingRecord;
			try {
				const value = JSON.parse(raw) as unknown;
				const parsed = recordSchema.safeParse(value);
				if (!parsed.success) {
					await getValkeyClient().zrem(cleanupKey(), id);
					return finishedSchema.safeParse(value).success
						? "skipped"
						: "unconfirmed";
				}
				record = parsed.data;
			} catch {
				await getValkeyClient().zrem(cleanupKey(), id);
				return "unconfirmed";
			}
			if (record.state !== "claimed") {
				await getValkeyClient().zrem(cleanupKey(), id);
				return "skipped";
			}
			const owner = randomUUID();
			if (
				(await getValkeyClient().eval(
					RECOVER,
					2,
					key(id),
					cleanupKey(),
					record.owner,
					owner,
					Date.now(),
				)) !== 1
			)
				return "skipped";
			const access = InteractionAccess.parse(record);
			if (
				!access ||
				!(await cleanupInteraction(record.target, access, randomUUID()))
			)
				return "unconfirmed";
			await finishRecord(record, owner, record.browserId, {
				status: 409,
				body: {
					reason:
						record.intent.purpose === "credential_approval"
							? "operation_outcome_unknown"
							: "authentication_outcome_unknown",
					message:
						record.intent.purpose === "credential_approval"
							? "The protected operation may have completed. Review the affected account, task or restore before retrying."
							: "Authentication was interrupted and any issued session family was revoked. Begin again.",
				},
			});
			return "cleaned";
		}),
	);
	return {
		attempted: results.filter((result) => result !== "skipped").length,
		cleaned: results.filter((result) => result === "cleaned").length,
		unconfirmed: results.filter((result) => result === "unconfirmed").length,
	};
}

const statusSchema = z.object({
	id: uuid,
	expires_at: z.iso.datetime({ offset: true }),
	state: z.enum([
		"pending",
		"ready",
		"denied",
		"expired",
		"cancelled",
		"consumed",
		"failed",
	]),
});
export type OwnedPollResult =
	| { state: "pending" | "ready" | "claimed"; retryAfter: number }
	| { state: "terminal"; error: AuthenticationError };

/** Status-only authority. It cannot issue credentials. A Valkey lease serializes
 * upstream polling across replicas without blocking a browser return claim. */
export class OwnedInteractionPoll {
	readonly #record: PendingRecord;
	private constructor(record: PendingRecord) {
		this.#record = record;
	}
	static async acquire(
		id: string,
		binding: InteractionOwner,
	): Promise<OwnedInteractionPoll> {
		return new OwnedInteractionPoll(await ownedPending(id, binding));
	}
	async poll(correlationId: string): Promise<OwnedPollResult> {
		const record = this.#record;
		if (record.state === "claimed") return { state: "claimed", retryAfter: 1 };
		const owner = randomUUID();
		if (
			(await getValkeyClient().eval(
				START_POLL,
				1,
				key(record.id),
				Date.now(),
				owner,
			)) !== 1
		)
			return {
				state: "pending",
				retryAfter: Math.max(
					1,
					Math.ceil(
						(Math.max(record.nextPollAt, record.pollUntil ?? 0) - Date.now()) /
							1000,
					),
				),
			};
		let delay = record.intervalSeconds;
		try {
			const access = InteractionAccess.parse(record);
			if (!access) throw new AuthenticationError("protocol_error");
			const payload = await interactionRequest(
				record.target,
				access,
				"status",
				correlationId,
			);
			const parsed = statusSchema.safeParse(payload);
			if (
				!parsed.success ||
				parsed.data.id !== record.id ||
				Date.parse(parsed.data.expires_at) !== record.expiresAt
			)
				throw new AuthenticationError("protocol_error");
			if (parsed.data.state === "pending" || parsed.data.state === "ready")
				return { state: parsed.data.state, retryAfter: delay };
			const reason = {
				denied: "access_denied",
				expired: "interaction_expired",
				cancelled: "interaction_cancelled",
				consumed: "interaction_consumed",
				failed: "interaction_failed",
			} as const;
			return {
				state: "terminal",
				error: new AuthenticationError(reason[parsed.data.state]),
			};
		} catch (error) {
			if (
				error instanceof AuthenticationError &&
				!["slow_down", "provider_unavailable"].includes(error.reason)
			)
				return { state: "terminal", error };
			delay = Math.max(
				delay * 2,
				error instanceof AuthenticationError ? (error.retryAfter ?? 0) : 0,
			);
			return { state: "pending", retryAfter: delay };
		} finally {
			await getValkeyClient().eval(
				END_POLL,
				1,
				key(record.id),
				owner,
				Date.now() + delay * 1000,
			);
		}
	}
}

const finishedSchema = z.object({
	id: uuid,
	state: z.literal("finished"),
	browserId: uuid,
	originalBrowserId: uuid,
	nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	returnPath: z
		.string()
		.max(4096)
		.refine((path) => normalizeReturnPath(path) === path),
	purpose: z.enum(["login", "credential_approval", "provider_verification"]),
	loginAccepted: z.boolean(),
	target: z.object({ origin: z.string(), revision: z.string() }),
	sessionId: uuid.optional(),
	result: z.unknown(),
});

/** Redeliver the same opaque session cookie after a lost frontend response.
 * No Hubuum completion is replayed and no bearer or redemption proof is retained. */
export class CompletedLoginHandoff {
	readonly #sid: string;
	readonly #returnPath: string;
	private constructor(sid: string, returnPath: string) {
		this.#sid = sid;
		this.#returnPath = returnPath;
	}
	get sid(): string {
		return this.#sid;
	}
	get returnPath(): string {
		return this.#returnPath;
	}
	static async acquire(
		id: string,
		binding: InteractionOwner,
	): Promise<CompletedLoginHandoff | null> {
		if (
			!uuid.safeParse(id).success ||
			!uuid.safeParse(binding.browserId).success ||
			!/^[A-Za-z0-9_-]{43}$/.test(binding.nonce)
		)
			throw new AuthenticationError("interaction_invalid");
		const raw = await getValkeyClient().get(key(id));
		if (!raw) return null;
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			throw new AuthenticationError("protocol_error");
		}
		const parsed = finishedSchema.safeParse(value);
		if (
			!parsed.success ||
			parsed.data.purpose !== "login" ||
			!parsed.data.loginAccepted
		)
			return null;
		const record = parsed.data;
		if (
			(binding.browserId !== record.browserId &&
				binding.browserId !== record.originalBrowserId) ||
			!sameNonce(record.nonce, binding.nonce) ||
			record.target.origin !== binding.target.origin ||
			record.target.revision !== binding.target.revision
		)
			throw new AuthenticationError("interaction_invalid");
		return new CompletedLoginHandoff(record.browserId, record.returnPath);
	}
}

/** Reads are browser/backend/family-bound; completed one-time output is consumed
 * atomically and can never be used to replay the protected operation. */
export async function readInteractionResult(
	id: string,
	binding: InteractionOwner,
): Promise<{ state: string; purpose: string; result?: unknown }> {
	const { browserId, target, sessionId, nonce } = binding;
	if (!uuid.safeParse(id).success || !/^[A-Za-z0-9_-]{43}$/.test(nonce))
		throw new AuthenticationError("interaction_invalid");
	const raw = await getValkeyClient().get(key(id));
	if (!raw) throw new AuthenticationError("interaction_invalid");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new AuthenticationError("protocol_error");
	}
	const finished = finishedSchema.safeParse(value);
	if (finished.success) {
		const record = finished.data;
		if (
			record.browserId !== browserId ||
			!sameNonce(record.nonce, nonce) ||
			record.target.origin !== target.origin ||
			record.target.revision !== target.revision ||
			(record.purpose !== "login" && record.sessionId !== sessionId)
		)
			throw new AuthenticationError("interaction_invalid");
		if (record.result == null)
			throw new AuthenticationError("interaction_consumed");
		if (
			(await getValkeyClient().eval(
				RESULT,
				1,
				key(id),
				raw,
				JSON.stringify({ ...record, result: null }),
			)) !== 1
		)
			throw new AuthenticationError("interaction_consumed");
		return {
			state: "finished",
			purpose: record.purpose,
			result: record.result,
		};
	}
	const pending = recordSchema.safeParse(value);
	if (
		!pending.success ||
		pending.data.browserId !== browserId ||
		!sameNonce(pending.data.nonce, nonce) ||
		pending.data.target.origin !== target.origin ||
		pending.data.target.revision !== target.revision ||
		(pending.data.intent.purpose !== "login" &&
			pending.data.intent.actor.sessionId !== sessionId)
	)
		throw new AuthenticationError("interaction_invalid");
	return { state: pending.data.state, purpose: pending.data.intent.purpose };
}
