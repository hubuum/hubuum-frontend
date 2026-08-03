import { normalizeIdempotencyKey } from "@/lib/idempotency-key";

export const OPERATION_IDEMPOTENCY_RETENTION_MS = 30 * 60 * 1000;
export const MAX_OPERATION_IDEMPOTENCY_ENTRIES = 64;

const STORAGE_KEY = "hubuum.operation-idempotency.v1";
const textEncoder = new TextEncoder();

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type StoredEntry = {
	createdAt: number;
	key: string;
};

type StoredState = Record<string, StoredEntry>;

type OperationIdempotencyManagerOptions = {
	hash?: (value: string) => Promise<string>;
	now?: () => number;
	randomUUID?: () => string;
	retentionMs?: number;
	storage?: StorageLike | null | (() => StorageLike | null);
};

export type OperationIdempotencyLease = {
	key: string;
	complete: () => void;
};

function canonicalizeJsonValue(
	value: unknown,
	seen: Set<object>,
): unknown {
	if (value === null) {
		return null;
	}

	if (typeof value === "string" || typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value === "bigint") {
		throw new TypeError("Operation payloads cannot contain bigint values.");
	}

	if (
		typeof value === "undefined" ||
		typeof value === "function" ||
		typeof value === "symbol"
	) {
		return undefined;
	}

	if (seen.has(value)) {
		throw new TypeError("Operation payloads cannot contain circular references.");
	}

	const toJson = (value as { toJSON?: unknown }).toJSON;
	if (typeof toJson === "function") {
		return canonicalizeJsonValue(
			(toJson as () => unknown).call(value),
			seen,
		);
	}

	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map(
				(item) => canonicalizeJsonValue(item, seen) ?? null,
			);
		}

		const record = value as Record<string, unknown>;
		const normalized: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			const item = canonicalizeJsonValue(record[key], seen);
			if (item !== undefined) {
				normalized[key] = item;
			}
		}
		return normalized;
	} finally {
		seen.delete(value);
	}
}

export function canonicalizeOperationPayload(value: unknown): string {
	return JSON.stringify(canonicalizeJsonValue(value, new Set()) ?? null);
}

async function sha256(value: string): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw new Error("Web Crypto is required to protect retry-safe operations.");
	}

	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		textEncoder.encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function defaultRandomUUID(): string {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID();
	}

	if (!globalThis.crypto?.getRandomValues) {
		throw new Error("Secure randomness is required for idempotency keys.");
	}

	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
	return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function browserSessionStorage(): StorageLike | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function parseState(raw: string | null): StoredState {
	if (!raw) {
		return {};
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}

		const state: StoredState = {};
		for (const [fingerprint, candidate] of Object.entries(parsed)) {
			if (
				candidate &&
				typeof candidate === "object" &&
				!Array.isArray(candidate)
			) {
				const entry = candidate as Partial<StoredEntry>;
				if (
					typeof entry.createdAt === "number" &&
					Number.isFinite(entry.createdAt) &&
					typeof entry.key === "string" &&
					normalizeIdempotencyKey(entry.key)
				) {
					state[fingerprint] = {
						createdAt: entry.createdAt,
						key: entry.key,
					};
				}
			}
		}
		return state;
	} catch {
		return {};
	}
}

function operationKeyPrefix(scope: string): string {
	const slug = scope
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return slug || "operation";
}

export function createOperationIdempotencyManager(
	options: OperationIdempotencyManagerOptions = {},
) {
	const hash = options.hash ?? sha256;
	const now = options.now ?? Date.now;
	const randomUUID = options.randomUUID ?? defaultRandomUUID;
	const retentionMs =
		options.retentionMs ?? OPERATION_IDEMPOTENCY_RETENTION_MS;
	let memoryState: StoredState = {};

	function resolveStorage(): StorageLike | null {
		if (typeof options.storage === "function") {
			return options.storage();
		}
		if (options.storage !== undefined) {
			return options.storage;
		}
		return browserSessionStorage();
	}

	function pruneState(state: StoredState, timestamp: number): StoredState {
		const validEntries = Object.entries(state)
			.filter(([, entry]) => timestamp - entry.createdAt < retentionMs)
			.sort((left, right) => right[1].createdAt - left[1].createdAt)
			.slice(0, MAX_OPERATION_IDEMPOTENCY_ENTRIES);
		return Object.fromEntries(validEntries);
	}

	function loadState(): StoredState {
		const storage = resolveStorage();
		let state = memoryState;
		if (storage) {
			try {
				state = {
					...state,
					...parseState(storage.getItem(STORAGE_KEY)),
				};
			} catch {
				// Fall back to the process-local state when storage is unavailable.
			}
		}
		memoryState = pruneState(state, now());
		return { ...memoryState };
	}

	function saveState(state: StoredState): void {
		memoryState = pruneState(state, now());
		const storage = resolveStorage();
		if (!storage) {
			return;
		}
		try {
			storage.setItem(STORAGE_KEY, JSON.stringify(memoryState));
		} catch {
			// The in-memory state still protects retries in this page process.
		}
	}

	async function acquire(
		scope: string,
		payload: unknown,
		requestedKey?: string | null,
	): Promise<OperationIdempotencyLease> {
		const normalizedScope = scope.trim();
		if (!normalizedScope) {
			throw new Error("An operation idempotency scope is required.");
		}

		const fingerprint = await hash(
			`${normalizedScope}\n${canonicalizeOperationPayload(payload)}`,
		);
		const state = loadState();
		const existing = state[fingerprint];
		const key =
			existing?.key ??
			normalizeIdempotencyKey(requestedKey) ??
			normalizeIdempotencyKey(
				`hubuum-${operationKeyPrefix(normalizedScope)}-${randomUUID()}`,
			);
		if (!key) {
			throw new Error("Could not create an idempotency key.");
		}

		if (!existing) {
			state[fingerprint] = { createdAt: now(), key };
			saveState(state);
		}

		let completed = false;
		return {
			key,
			complete: () => {
				if (completed) {
					return;
				}
				completed = true;
				const current = loadState();
				if (current[fingerprint]?.key === key) {
					delete current[fingerprint];
					saveState(current);
				}
			},
		};
	}

	return { acquire };
}

const operationIdempotencyManager = createOperationIdempotencyManager();

export function acquireOperationIdempotencyKey(
	scope: string,
	payload: unknown,
	requestedKey?: string | null,
): Promise<OperationIdempotencyLease> {
	return operationIdempotencyManager.acquire(scope, payload, requestedKey);
}
