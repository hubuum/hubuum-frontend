import assert from "node:assert/strict";
import test from "node:test";
import { sessionTokenProvider } from "./session-token.mjs";

function pair() {
	return {
		session_id: crypto.randomUUID(),
		token_type: "Bearer",
		access_token: "access-secret",
		refresh_token: "refresh-secret",
		access_expires_at: new Date(Date.now() + 1000).toISOString(),
		refresh_expires_at: new Date(Date.now() + 60_000).toISOString(),
		absolute_expires_at: new Date(Date.now() + 120_000).toISOString(),
	};
}

test("parallel callers rotate once and use the complete new pair", async (t) => {
	const initial = pair();
	let count = 0;
	const token = sessionTokenProvider(initial, async (refresh) => {
		assert.equal(refresh, initial.refresh_token);
		count += 1;
		await Promise.resolve();
		return {
			...initial,
			access_token: "next-access",
			refresh_token: "next-refresh",
			access_expires_at: new Date(Date.now() + 30_000).toISOString(),
		};
	});
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	t.mock.timers.tick(1100);
	assert.deepEqual(
		await Promise.all(Array.from({ length: 20 }, () => token())),
		Array(20).fill("next-access"),
	);
	assert.equal(count, 1);
});

test("an uncertain refresh is cleared and never retried", async (t) => {
	let count = 0;
	const token = sessionTokenProvider(pair(), async () => {
		count += 1;
		throw new Error("refresh-secret");
	});
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	t.mock.timers.tick(1100);
	const failures = await Promise.allSettled(
		Array.from({ length: 20 }, () => token()),
	);
	assert.ok(
		failures.every(
			(outcome) =>
				outcome.status === "rejected" &&
				!String(outcome.reason).includes("refresh-secret"),
		),
	);
	await assert.rejects(token(), /unavailable/);
	assert.equal(count, 1);
});
