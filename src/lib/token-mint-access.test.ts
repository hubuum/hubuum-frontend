import { describe, expect, it } from "vitest";

import { getTokenMintAccess } from "@/lib/token-mint-access";

const humanActor = {
	actorKind: "user",
	actorPrincipalId: 7,
	currentTokenScoped: false,
} as const;

describe("token mint access", () => {
	it("allows a human user with an unscoped token to mint for themselves", () => {
		expect(
			getTokenMintAccess({
				...humanActor,
				authority: "self",
				targetKind: "human",
				targetPrincipalId: 7,
			}),
		).toEqual({ allowed: true, reason: null });
	});

	it("rejects self-service minting from a scoped token", () => {
		expect(
			getTokenMintAccess({
				...humanActor,
				authority: "self",
				currentTokenScoped: true,
				targetKind: "human",
				targetPrincipalId: 7,
			}),
		).toEqual({
			allowed: false,
			reason: "Self-service token creation requires an unscoped session token.",
		});
	});

	it("allows a human admin to mint for human and service principals", () => {
		for (const targetKind of ["human", "service_account"] as const) {
			expect(
				getTokenMintAccess({
					...humanActor,
					authority: "admin",
					targetKind,
					targetPrincipalId: 12,
				}).allowed,
			).toBe(true);
		}
	});

	it("allows a human manager to mint for an active service account", () => {
		expect(
			getTokenMintAccess({
				...humanActor,
				authority: "service_account_manager",
				targetKind: "service_account",
				targetPrincipalId: 12,
			}).allowed,
		).toBe(true);
	});

	it("rejects every service-account actor, including admin contexts", () => {
		expect(
			getTokenMintAccess({
				actorKind: "service_account",
				actorPrincipalId: 7,
				authority: "admin",
				currentTokenScoped: false,
				targetKind: "human",
				targetPrincipalId: 12,
			}),
		).toEqual({
			allowed: false,
			reason: "Service accounts cannot mint tokens.",
		});
	});

	it("rejects tokens for disabled service accounts", () => {
		expect(
			getTokenMintAccess({
				...humanActor,
				authority: "service_account_manager",
				targetDisabled: true,
				targetKind: "service_account",
				targetPrincipalId: 12,
			}),
		).toEqual({
			allowed: false,
			reason: "Disabled service accounts cannot receive new tokens.",
		});
	});
});
