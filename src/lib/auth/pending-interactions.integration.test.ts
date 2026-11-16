import Redis from "ioredis";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	ClaimedInteraction,
	CompletedLoginHandoff,
	OwnedInteractionPoll,
	createPendingInteraction,
	readInteractionResult,
	recoverAbandonedInteractions,
} from "./pending-interactions";

const state = vi.hoisted(() => ({
	clients: [] as Redis[],
	index: 0,
	prefix: `hubuum-auth-test:${crypto.randomUUID()}:`,
	fetch: vi.fn(),
}));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => state.clients[state.index++ % state.clients.length],
}));
vi.mock("@/lib/env", () => ({
	getServerEnv: () => ({ SESSION_PREFIX: state.prefix }),
}));
const target = { origin: "https://auth.example", revision: "accepted" };
vi.mock("@/lib/api/backend", () => ({ backendFetchRaw: state.fetch }));
function fixture() {
	return {
		id: crypto.randomUUID(),
		providerId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
		redemption_secret: `hai1.${"a".repeat(64)}`,
		browserId: crypto.randomUUID(),
		nonce: "a".repeat(43),
		target,
		intent: { purpose: "login" as const },
		returnPath: "/app",
		expiresAt: Date.now() + 300_000,
		intervalSeconds: 5,
	};
}
describe.skipIf(!process.env.HUBUUM_TEST_VALKEY_URL)(
	"owned authentication Valkey transactions",
	() => {
		beforeAll(() => {
			state.clients = Array.from(
				{ length: 2 },
				() => new Redis(process.env.HUBUUM_TEST_VALKEY_URL as string),
			);
		});
		afterAll(async () => {
			const keys = await state.clients[0].keys(`${state.prefix}*`);
			if (keys.length) await state.clients[0].del(...keys);
			await Promise.all(state.clients.map((client) => client.quit()));
		});
		it("grants only one completion across replicas and removes proofs on finish", async () => {
			const pending = fixture();
			await createPendingInteraction(pending);
			const claims = await Promise.allSettled(
				Array.from({ length: 20 }, () =>
					ClaimedInteraction.acquire(pending.id, pending),
				),
			);
			const won = claims.filter((claim) => claim.status === "fulfilled");
			expect(won).toHaveLength(1);
			if (won[0].status !== "fulfilled") throw new Error("claim missing");
			await won[0].value.finish(pending.browserId, { authenticated: true });
			const raw = await state.clients[0].get(
				`${state.prefix}auth:interaction:${pending.id}`,
			);
			expect(raw).toContain('"finished"');
			expect(raw).not.toContain(pending.redemption_secret);
			await expect(
				ClaimedInteraction.acquire(pending.id, pending),
			).rejects.toThrow();
		});
		it.each(["browserId", "nonce"] as const)(
			"does not burn a victim interaction on a wrong %s",
			async (field) => {
				const pending = fixture();
				await createPendingInteraction(pending);
				await expect(
					ClaimedInteraction.acquire(pending.id, {
						...pending,
						[field]:
							field === "browserId" ? crypto.randomUUID() : "b".repeat(43),
					}),
				).rejects.toThrow("Invalid authentication interaction");
				await expect(
					ClaimedInteraction.acquire(pending.id, pending),
				).resolves.toBeInstanceOf(ClaimedInteraction);
			},
		);
		it("rejects a changed backend revision without forwarding the proof", async () => {
			const pending = fixture();
			await createPendingInteraction(pending);
			await expect(
				ClaimedInteraction.acquire(pending.id, {
					...pending,
					target: { ...target, revision: "replacement" },
				}),
			).rejects.toThrow("Invalid authentication interaction");
		});
		it("keeps fresh approval bound to its initiating browser and session family", async () => {
			const pending = fixture();
			const sessionId = crypto.randomUUID();
			await createPendingInteraction({
				...pending,
				intent: {
					purpose: "credential_approval",
					actor: {
						sid: pending.browserId,
						sessionId,
						token: "original-actor-credential",
					},
					mutation: {
						method: "POST",
						path: "/api/v1/iam/users",
						body: { name: "example" },
					},
				},
			});
			await expect(
				ClaimedInteraction.acquire(pending.id, {
					...pending,
					sessionId: crypto.randomUUID(),
				}),
			).rejects.toThrow();
			const claimed = await ClaimedInteraction.acquire(pending.id, {
				...pending,
				sessionId,
			});
			const exposed = claimed.intent;
			if (exposed.purpose !== "credential_approval")
				throw new Error("fixture intent missing");
			exposed.mutation.body.name = "changed-by-caller";
			expect(claimed.intent).toMatchObject({
				mutation: { body: { name: "example" } },
			});
			await claimed.finish(pending.browserId, { completed: true });
			expect(
				await state.clients[0].get(
					`${state.prefix}auth:interaction:${pending.id}`,
				),
			).not.toContain("original-actor-credential");
		});
		beforeEach(() => {
			state.fetch.mockReset();
		});
		it("redelivers only the same bound login handoff after a lost frontend response", async () => {
			const pending = fixture();
			await createPendingInteraction(pending);
			const claimed = await ClaimedInteraction.acquire(pending.id, pending);
			const sid = crypto.randomUUID();
			await claimed.finish(sid, { authenticated: true });
			const handoff = await CompletedLoginHandoff.acquire(pending.id, pending);
			expect(handoff?.sid).toBe(sid);
			expect(JSON.stringify(handoff)).not.toContain(sid);
			await expect(
				CompletedLoginHandoff.acquire(pending.id, {
					...pending,
					browserId: crypto.randomUUID(),
				}),
			).rejects.toThrow();
			await expect(
				CompletedLoginHandoff.acquire(pending.id, {
					...pending,
					nonce: "b".repeat(43),
				}),
			).rejects.toThrow();
			await expect(
				readInteractionResult(pending.id, {
					...pending,
					browserId: sid,
					nonce: "b".repeat(43),
				}),
			).rejects.toThrow();
			await readInteractionResult(pending.id, { ...pending, browserId: sid });
			expect(
				(await CompletedLoginHandoff.acquire(pending.id, pending))?.sid,
			).toBe(sid);
			expect(state.fetch).not.toHaveBeenCalled();
		});
		it("serializes upstream polls and preserves a concurrent completion claim", async () => {
			const pending = fixture();
			await createPendingInteraction(pending);
			const recordKey = `${state.prefix}auth:interaction:${pending.id}`;
			const raw = await state.clients[0].get(recordKey);
			await state.clients[0].set(
				recordKey,
				JSON.stringify({ ...JSON.parse(raw ?? "null"), nextPollAt: 0 }),
				"EX",
				300,
			);
			let release: ((response: Response) => void) | undefined;
			state.fetch.mockImplementation(
				() =>
					new Promise<Response>((resolve) => {
						release = resolve;
					}),
			);
			const polls = Array.from({ length: 20 }, async () =>
				(await OwnedInteractionPoll.acquire(pending.id, pending)).poll(
					"correlation",
				),
			);
			await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
			const claimed = await ClaimedInteraction.acquire(pending.id, pending);
			if (!release) throw new Error("status fixture was not called");
			release(
				Response.json({
					id: pending.id,
					state: "pending",
					expires_at: new Date(pending.expiresAt).toISOString(),
				}),
			);
			await Promise.all(polls);
			expect(state.fetch).toHaveBeenCalledOnce();
			expect(
				JSON.parse((await state.clients[0].get(recordKey)) ?? "null").state,
			).toBe("claimed");
			expect(JSON.stringify(claimed)).not.toContain(pending.redemption_secret);
			await claimed.finish(pending.browserId, { completed: true });
		});
		it("atomically bounds pending interactions per browser", async () => {
			const browserId = crypto.randomUUID();
			const pending = Array.from({ length: 12 }, () => ({
				...fixture(),
				browserId,
			}));
			const results = await Promise.allSettled(
				pending.map(createPendingInteraction),
			);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(4);
		});
		it("fences a crashed owner before exact-family cleanup across workers", async () => {
			const pending = fixture();
			await createPendingInteraction(pending);
			const oldOwner = await ClaimedInteraction.acquire(pending.id, pending);
			const recordKey = `${state.prefix}auth:interaction:${pending.id}`;
			expect(await state.clients[0].pttl(recordKey)).toBeGreaterThan(3_500_000);
			const record = JSON.parse(
				(await state.clients[0].get(recordKey)) ?? "null",
			);
			await state.clients[0].set(
				recordKey,
				JSON.stringify({ ...record, claimedAt: Date.now() - 100_000 }),
				"PX",
				3_600_000,
			);
			await state.clients[0].zadd(`${state.prefix}auth:cleanup`, 0, pending.id);
			state.fetch.mockImplementation(
				async () => new Response(null, { status: 204 }),
			);
			const workers = await Promise.all([
				recoverAbandonedInteractions(),
				recoverAbandonedInteractions(),
			]);
			expect(workers.reduce((sum, result) => sum + result.cleaned, 0)).toBe(1);
			expect(state.fetch.mock.calls.map(([path]) => path)).toEqual([
				`/api/v1/auth/interactions/${pending.id}/cancel`,
				`/api/v1/auth/interactions/${pending.id}/issued-session/revoke`,
			]);
			await expect(
				oldOwner.finish(pending.browserId, { authenticated: true }),
			).rejects.toThrow();
			expect(await state.clients[0].get(recordKey)).not.toContain(
				pending.redemption_secret,
			);
		});
		it("does not revoke an accepted session from a stale cleanup index entry", async () => {
			const pending = fixture();
			await createPendingInteraction(pending);
			const owner = await ClaimedInteraction.acquire(pending.id, pending);
			await owner.finish(crypto.randomUUID(), { authenticated: true });
			await state.clients[0].zadd(`${state.prefix}auth:cleanup`, 0, pending.id);
			expect((await recoverAbandonedInteractions()).cleaned).toBe(0);
			expect(state.fetch).not.toHaveBeenCalled();
		});
		it("retains uncertain cleanup authority and backs off without completing again", async () => {
			const pending = fixture();
			await createPendingInteraction(pending);
			await ClaimedInteraction.acquire(pending.id, pending);
			const recordKey = `${state.prefix}auth:interaction:${pending.id}`;
			const record = JSON.parse(
				(await state.clients[0].get(recordKey)) ?? "null",
			);
			await state.clients[0].set(
				recordKey,
				JSON.stringify({ ...record, claimedAt: Date.now() - 100_000 }),
				"PX",
				3_600_000,
			);
			await state.clients[0].zadd(`${state.prefix}auth:cleanup`, 0, pending.id);
			state.fetch.mockRejectedValue(new Error("fixture network outage"));
			expect((await recoverAbandonedInteractions()).unconfirmed).toBe(1);
			expect(await state.clients[0].get(recordKey)).toContain(
				pending.redemption_secret,
			);
			expect((await recoverAbandonedInteractions()).attempted).toBe(0);
			expect(state.fetch).toHaveBeenCalledOnce();
		});
	},
);
