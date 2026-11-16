import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	loadCandidateReport,
	preserveCandidateReport,
	publicCandidateReport,
} from "./candidate-verification";

const mocks = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("@/lib/env", () => ({
	getServerEnv: () => ({ SESSION_PREFIX: "test:" }),
}));
vi.mock("@/lib/valkey", () => ({
	getValkeyClient: () => ({
		get: async (key: string) => mocks.values.get(key) ?? null,
		set: async (key: string, value: string) => {
			mocks.values.set(key, value);
			return "OK";
		},
		del: async (key: string) => Number(mocks.values.delete(key)),
	}),
}));
const actor = {
	sid: "private-session",
	token: "private-actor-token",
	sessionId: "family",
};
const target = { origin: "https://auth.example", revision: "one" };
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const receipt = `hcv1.${"a".repeat(64)}`;
function report(group: "authentication" | "authorization" = "authentication") {
	return {
		id,
		group,
		base_revision: 1,
		expires_at: new Date(Date.now() + 300_000).toISOString(),
		state: "verified",
		verification_receipt: receipt,
		providers: [],
		checks: [],
	};
}

describe("private candidate ownership", () => {
	beforeEach(() => mocks.values.clear());
	it.each(["authentication", "authorization"] as const)(
		"keeps the %s receipt private",
		async (group) => {
			const visible = await preserveCandidateReport(
				actor,
				target,
				report(group),
			);
			expect(JSON.stringify(visible)).not.toContain(receipt);
			expect(
				(await loadCandidateReport(actor, target, id)).verification_receipt,
			).toBe(receipt);
		},
	);
	it.each(["token", "sessionId", "sid", "target", "revision"])(
		"rejects changed %s ownership",
		async (changed) => {
			await preserveCandidateReport(actor, target, report());
			const owner = {
				...actor,
				...(changed in actor ? { [changed]: "another" } : {}),
			};
			const current = {
				...target,
				...(changed === "target"
					? { origin: "https://other.example" }
					: changed === "revision"
						? { revision: "two" }
						: {}),
			};
			await expect(
				loadCandidateReport(owner, current, id),
			).rejects.toMatchObject({ reason: "configuration_changed" });
		},
	);
	it("preserves a private receipt when a status read does not redisclose it", async () => {
		await preserveCandidateReport(actor, target, report());
		const previous = await loadCandidateReport(actor, target, id);
		const visible = await preserveCandidateReport(
			actor,
			target,
			publicCandidateReport(previous),
			previous,
		);
		expect(visible).not.toHaveProperty("verification_receipt");
		expect(
			(await loadCandidateReport(actor, target, id)).verification_receipt,
		).toBe(receipt);
	});
	it("does not carry a receipt onto a changed candidate revision", async () => {
		await preserveCandidateReport(actor, target, report());
		const previous = await loadCandidateReport(actor, target, id);
		await expect(
			preserveCandidateReport(
				actor,
				target,
				{ ...publicCandidateReport(previous), base_revision: 2 },
				previous,
			),
		).rejects.toMatchObject({ reason: "protocol_error" });
	});
	it("clears an existing receipt when a candidate is no longer verified", async () => {
		await preserveCandidateReport(actor, target, report());
		const previous = await loadCandidateReport(actor, target, id);
		await preserveCandidateReport(
			actor,
			target,
			{ ...publicCandidateReport(previous), state: "failed" },
			previous,
		);
		expect(
			(await loadCandidateReport(actor, target, id)).verification_receipt,
		).toBeUndefined();
	});
});
