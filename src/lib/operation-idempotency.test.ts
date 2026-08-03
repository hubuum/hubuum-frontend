import { describe, expect, it } from "vitest";

import {
	canonicalizeOperationPayload,
	createOperationIdempotencyManager,
	OPERATION_IDEMPOTENCY_RETENTION_MS,
} from "@/lib/operation-idempotency";

class MemoryStorage {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

function deterministicHash(value: string): Promise<string> {
	let hash = 2166136261;
	for (const character of value) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return Promise.resolve((hash >>> 0).toString(16).padStart(8, "0"));
}

describe("canonicalizeOperationPayload", () => {
	it("sorts object keys while preserving array order", () => {
		expect(
			canonicalizeOperationPayload({
				z: [3, { b: 2, a: 1 }],
				a: true,
			}),
		).toBe('{"a":true,"z":[3,{"a":1,"b":2}]}');
	});

	it("matches JSON semantics for omitted and non-finite values", () => {
		expect(
			canonicalizeOperationPayload({
				array: [undefined, Number.NaN],
				missing: undefined,
			}),
		).toBe('{"array":[null,null]}');
	});

	it("rejects circular payloads", () => {
		const payload: { self?: unknown } = {};
		payload.self = payload;
		expect(() => canonicalizeOperationPayload(payload)).toThrowError(
			"Operation payloads cannot contain circular references.",
		);
	});
});

describe("operation idempotency manager", () => {
	it("reuses the same key for equivalent retries", async () => {
		const storage = new MemoryStorage();
		const uuids = ["first", "second"];
		const manager = createOperationIdempotencyManager({
			hash: deterministicHash,
			randomUUID: () => uuids.shift() ?? "fallback",
			storage,
		});

		const first = await manager.acquire("export", { b: 2, a: 1 });
		const retry = await manager.acquire("export", { a: 1, b: 2 });

		expect(first.key).toBe("hubuum-export-first");
		expect(retry.key).toBe(first.key);
	});

	it("creates a fresh key after a successful response", async () => {
		const storage = new MemoryStorage();
		const uuids = ["first", "second"];
		const manager = createOperationIdempotencyManager({
			hash: deterministicHash,
			randomUUID: () => uuids.shift() ?? "fallback",
			storage,
		});

		const first = await manager.acquire("backup", { include_history: true });
		first.complete();
		first.complete();
		const next = await manager.acquire("backup", { include_history: true });

		expect(next.key).toBe("hubuum-backup-second");
	});

	it("keeps operations with different payloads or scopes separate", async () => {
		const storage = new MemoryStorage();
		let sequence = 0;
		const manager = createOperationIdempotencyManager({
			hash: deterministicHash,
			randomUUID: () => `key-${++sequence}`,
			storage,
		});

		const first = await manager.acquire("export", { query: "name=a" });
		const second = await manager.acquire("export", { query: "name=b" });
		const third = await manager.acquire("import", { query: "name=a" });

		expect(new Set([first.key, second.key, third.key])).toHaveLength(3);
	});

	it("uses a requested key as the retry lease seed", async () => {
		const storage = new MemoryStorage();
		const manager = createOperationIdempotencyManager({
			hash: deterministicHash,
			randomUUID: () => "unused",
			storage,
		});

		const first = await manager.acquire(
			"remote-target:7",
			{ body: {}, subject: 42 },
			" first-attempt ",
		);
		const retry = await manager.acquire(
			"remote-target:7",
			{ subject: 42, body: {} },
			"new-click-generated-key",
		);

		expect(first.key).toBe("first-attempt");
		expect(retry.key).toBe("first-attempt");
	});

	it("expires abandoned retry leases", async () => {
		const storage = new MemoryStorage();
		let timestamp = 10_000;
		const uuids = ["first", "second"];
		const manager = createOperationIdempotencyManager({
			hash: deterministicHash,
			now: () => timestamp,
			randomUUID: () => uuids.shift() ?? "fallback",
			storage,
		});

		const first = await manager.acquire("export", { query: "all" });
		timestamp += OPERATION_IDEMPOTENCY_RETENTION_MS;
		const expired = await manager.acquire("export", { query: "all" });

		expect(expired.key).not.toBe(first.key);
	});

	it("falls back to process memory when session storage throws", async () => {
		const manager = createOperationIdempotencyManager({
			hash: deterministicHash,
			randomUUID: () => "memory",
			storage: {
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
			},
		});

		const first = await manager.acquire("import", { version: 1 });
		const retry = await manager.acquire("import", { version: 1 });

		expect(retry.key).toBe(first.key);
	});

	it("stores only fingerprints and generated keys, not request payloads", async () => {
		const storage = new MemoryStorage();
		const manager = createOperationIdempotencyManager({
			hash: deterministicHash,
			randomUUID: () => "opaque",
			storage,
		});

		await manager.acquire("export", { secretValue: "do-not-store" });
		const stored = Array.from(storage.values.values()).join("\n");

		expect(stored).not.toContain("do-not-store");
		expect(stored).toContain("hubuum-export-opaque");
	});
});
