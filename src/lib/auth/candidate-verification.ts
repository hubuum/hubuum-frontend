import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";
import { AuthenticationError, providerIdSchema } from "./interactions-protocol";
import type { ClaimedInteraction } from "./pending-interactions";

const reportSchema = z.object({
	id: z.uuid(),
	group: z.literal("authentication"),
	base_revision: z.number().int().positive(),
	expires_at: z.iso.datetime({ offset: true }),
	state: z.enum(["unverified", "verified", "failed", "expired"]),
	verification_receipt: z
		.string()
		.regex(/^hcv1\.[0-9a-f]{64}$/)
		.nullable()
		.optional(),
	providers: z
		.array(
			z.object({
				provider_id: providerIdSchema,
				name: z.string().max(160),
				kind: z.enum(["ldap", "oidc", "oauth"]),
			}),
		)
		.max(256),
	checks: z
		.array(
			z.object({
				kind: z.string().max(256),
				status: z.string().max(128),
				provider_id: providerIdSchema.nullable().optional(),
				reason: z.string().max(512).nullable().optional(),
			}),
		)
		.max(2048),
});
const previewSchema = z.object({
	provider_id: providerIdSchema,
	candidate_id: z.uuid(),
	subject: z.string().max(4096),
	admitted: z.boolean(),
	groups: z
		.array(z.object({ key: z.string().max(4096), name: z.string().max(4096) }))
		.max(2048),
	membership: z.string().max(256),
	issued_session: z.literal(false),
	provisioned: z.literal(false),
});

/** Store the bound activation receipt privately; return only a non-provisioning
 * preview. The browser cannot obtain a receipt through the generic proxy. */
export async function preserveCandidatePreview(
	claimed: ClaimedInteraction,
	payload: unknown,
): Promise<unknown> {
	const intent = claimed.intent;
	const parsed = z
		.object({ candidate: reportSchema, verification: previewSchema })
		.safeParse(payload);
	if (intent.purpose !== "provider_verification" || !parsed.success)
		throw new AuthenticationError("protocol_error");
	const { candidate, verification } = parsed.data;
	if (
		candidate.id !== intent.candidateId ||
		verification.candidate_id !== intent.candidateId ||
		verification.provider_id !== claimed.providerId ||
		!candidate.providers.some(
			(provider) => provider.provider_id === claimed.providerId,
		) ||
		(candidate.state === "verified" && !candidate.verification_receipt)
	)
		throw new AuthenticationError("protocol_error");
	const ttl = Math.min(
		600,
		Math.floor((Date.parse(candidate.expires_at) - Date.now()) / 1000),
	);
	if (ttl < 1) throw new AuthenticationError("interaction_expired");
	await getValkeyClient().set(
		`${getServerEnv().SESSION_PREFIX}auth:candidate:${intent.actor.sid}:${candidate.id}`,
		JSON.stringify({
			target: claimed.target,
			sessionId: intent.actor.sessionId,
			credentialFingerprint: createHash("sha256")
				.update(intent.actor.token)
				.digest("hex"),
			report: candidate,
		}),
		"EX",
		ttl,
	);
	const { verification_receipt: _receipt, ...publicCandidate } = candidate;
	return { candidate: publicCandidate, verification };
}
