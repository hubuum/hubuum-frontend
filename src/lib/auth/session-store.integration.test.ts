import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionCredentials } from "@/test/session-fixtures";
import { sessionPayload } from "./session-credentials";
import { ValkeySessionStore } from "./session-store";

const connections = vi.hoisted(() => ({ clients: [] as Redis[], index: 0 }));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () =>
		connections.clients[connections.index++ % connections.clients.length],
}));

// Explicitly enabled by the live-backend suite; each operation uses another connection.
describe.skipIf(!process.env.HUBUUM_TEST_VALKEY_URL)(
	"Valkey session transactions",
	() => {
		const prefix = `hubuum-session-test:${crypto.randomUUID()}:`;
		const store = new ValkeySessionStore(3600, prefix);
		const otherInstance = new ValkeySessionStore(3600, prefix);
		beforeAll(() => {
			connections.clients = Array.from(
				{ length: 2 },
				() => new Redis(process.env.HUBUUM_TEST_VALKEY_URL as string),
			);
		});
		afterAll(async () => {
			const keys = await connections.clients[0].keys(`${prefix}*`);
			if (keys.length) await connections.clients[0].del(...keys);
			await Promise.all(connections.clients.map((client) => client.quit()));
		});

		it("grants only one refresh owner across connections", async () => {
			const payload = sessionPayload(sessionCredentials());
			await store.create("race", payload);
			const claims = await Promise.all(
				Array.from({ length: 20 }, (_, i) =>
					(i % 2 ? store : otherInstance).claimRefresh(
						"race",
						payload.generation,
						crypto.randomUUID(),
					),
				),
			);
			expect(claims.filter(Boolean)).toHaveLength(1);
		});

		it("prevents stale touches and invalidation from overwriting a rotated pair", async () => {
			const pair = sessionCredentials();
			const old = sessionPayload(pair);
			const next = sessionPayload({
				...pair,
				access_token: "new-access",
				refresh_token: "new-refresh",
			});
			await store.create("rotation", old);
			const owner = crypto.randomUUID();
			await store.claimRefresh("rotation", old.generation, owner);
			expect(await otherInstance.touch("rotation", old)).toBe(false);
			expect(
				await otherInstance.completeRefresh(
					"rotation",
					old.generation,
					crypto.randomUUID(),
					next,
				),
			).toBe(false);
			expect(
				await store.completeRefresh("rotation", old.generation, owner, next),
			).toBe(true);
			expect(await otherInstance.touch("rotation", old)).toBe(false);
			await otherInstance.invalidateGeneration("rotation", old.generation);
			expect(await store.get("rotation")).toEqual(next);
		});

		it("does not resurrect a session after logout", async () => {
			const old = sessionPayload(sessionCredentials());
			const owner = crypto.randomUUID();
			await store.create("logout", old);
			await store.claimRefresh("logout", old.generation, owner);
			await otherInstance.destroy("logout");
			expect(
				await store.completeRefresh("logout", old.generation, owner, old),
			).toBe(false);
			expect(await store.touch("logout", old)).toBe(false);
			expect(await store.get("logout")).toBeNull();
		});

		it("bounds Valkey expiry by the server deadline", async () => {
			const payload = sessionPayload(
				sessionCredentials({
					access_expires_at: new Date(Date.now() + 30_000).toISOString(),
					refresh_expires_at: new Date(Date.now() + 60_000).toISOString(),
				}),
			);
			await store.create("expiry", payload);
			const ttl = await connections.clients[0].ttl(`${prefix}expiry`);
			expect(ttl).toBeGreaterThan(0);
			expect(ttl).toBeLessThanOrEqual(60);
		});
	},
);
