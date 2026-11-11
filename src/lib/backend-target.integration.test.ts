import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	changeBackend,
	getBackendTarget,
	getSetupKey,
	initializeSetupKey,
	saveInitialBackend,
} from "@/lib/backend-target";

const state = vi.hoisted(() => ({ clients: [] as Redis[], index: 0 }));
vi.mock("@/lib/env", () => ({
	getServerEnv: () => ({
		SETTINGS_PREFIX: process.env.HUBUUM_SETUP_TEST_PREFIX,
	}),
}));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => state.clients[state.index++ % state.clients.length],
}));

// The setup wrapper starts a persistent, disposable Valkey and restarts it
// between separate test processes. Never use a developer-owned store here.
describe.skipIf(!process.env.HUBUUM_SETUP_TEST_PHASE)(
	"durable installation connection",
	() => {
		const prefix = process.env.HUBUUM_SETUP_TEST_PREFIX;
		beforeAll(() => {
			state.clients = Array.from({ length: 2 }, () => {
				const client = new Redis(process.env.VALKEY_URL as string, {
					retryStrategy: null,
					connectTimeout: 2000,
					commandTimeout: 2000,
				});
				client.on("error", () => {});
				return client;
			});
		});
		afterAll(() => {
			for (const client of state.clients) client.disconnect();
		});
		it.skipIf(process.env.HUBUUM_SETUP_TEST_PHASE !== "before")(
			"shares a generated key across replicas and saves one durable connection",
			async () => {
				const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
				try {
					await Promise.all(
						Array.from({ length: 10 }, () => initializeSetupKey()),
					);
					expect(output).toHaveBeenCalledTimes(1);
					const key = await getSetupKey();
					expect(typeof key === "string" && /^[a-f0-9]{64}$/.test(key)).toBe(
						true,
					);
				} finally {
					output.mockRestore();
				}
				const results = await Promise.all([
					saveInitialBackend("https://first.test"),
					saveInitialBackend("https://other.test"),
				]);
				expect(results.filter(Boolean)).toHaveLength(1);
				expect(await getSetupKey()).toBeNull();
				const first = await getBackendTarget();
				if (!first) throw new Error("Missing initial target");
				expect(await changeBackend(first, "https://second.test")).toBe(true);
				expect(await changeBackend(first, "https://stale.test")).toBe(false);
				const saved = await getBackendTarget();
				expect(saved?.origin).toBe("https://second.test");
				await state.clients[0].set(`${prefix}expected`, JSON.stringify(saved));
				expect(
					await state.clients[0].ttl(`${prefix}installation:backend`),
				).toBe(-1);
			},
		);
		it.skipIf(process.env.HUBUUM_SETUP_TEST_PHASE !== "after")(
			"loads the identical choice after Valkey and frontend process restarts",
			async () => {
				const expected = await state.clients[0].get(`${prefix}expected`);
				expect(expected).not.toBeNull();
				expect(await getBackendTarget()).toEqual(
					JSON.parse(expected ?? "null"),
				);
				expect(await getSetupKey()).toBeNull();
				const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
				try {
					await initializeSetupKey(true);
					expect(output).not.toHaveBeenCalled();
				} finally {
					output.mockRestore();
				}
				const keys = await state.clients[0].keys(`${prefix}*`);
				if (keys.length) await state.clients[0].del(...keys);
			},
		);
	},
);
