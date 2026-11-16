import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";
import { AuthenticationError, providerIdSchema } from "./interactions-protocol";
import type { ClaimedInteraction } from "./pending-interactions";
import type { ActiveSession } from "./session";
import type { BackendTarget } from "@/lib/backend-target";

const reportSchema = z.object({
	id: z.uuid(),
	group: z.enum(["authentication", "authorization"]),
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

type CandidateOwner = Pick<ActiveSession, "sid" | "token" | "sessionId">;
const storedSchema = z.object({
	target: z.object({ origin: z.string(), revision: z.string() }),
	sessionId: z.string(),
	credentialFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	report: reportSchema,
});
const fingerprint = (actor: CandidateOwner) =>
	createHash("sha256").update(actor.token).digest("hex");
const key = (actor: CandidateOwner, id: string) =>
	`${getServerEnv().SESSION_PREFIX}auth:candidate:${actor.sid}:${z.uuid().parse(id)}`;

export function publicCandidateReport(report: z.infer<typeof reportSchema>) {
	const { verification_receipt: _receipt, ...visible } = report;
	return visible;
}

export function parseCandidateReport(payload: unknown) {
	const parsed = reportSchema.safeParse(payload);
	if (!parsed.success) throw new AuthenticationError("protocol_error");
	return parsed.data;
}

export async function loadCandidateReport(
	actor: CandidateOwner,
	target: BackendTarget,
	id: string,
) {
	const raw = await getValkeyClient().get(key(actor, id));
	const stored = storedSchema.safeParse(raw ? JSON.parse(raw) : null);
	if (
		!stored.success ||
		stored.data.target.origin !== target.origin ||
		stored.data.target.revision !== target.revision ||
		stored.data.report.id !== id ||
		stored.data.sessionId !== actor.sessionId ||
		stored.data.credentialFingerprint !== fingerprint(actor) ||
		Date.parse(stored.data.report.expires_at) <= Date.now()
	) {
		throw new AuthenticationError("configuration_changed");
	}
	return stored.data.report;
}

export async function preserveCandidateReport(
	actor: CandidateOwner,
	target: BackendTarget,
	payload: unknown,
	previous?: z.infer<typeof reportSchema>,
) {
	const report = parseCandidateReport(payload);
	if (
		previous &&
		(report.id !== previous.id ||
			report.group !== previous.group ||
			report.base_revision !== previous.base_revision ||
			report.expires_at !== previous.expires_at ||
			JSON.stringify(report.providers) !== JSON.stringify(previous.providers))
	) {
		throw new AuthenticationError("protocol_error");
	}
	// Status reads deliberately do not redisclose receipts. Preserve the existing
	// owner-bound receipt only for the same still-verified candidate.
	if (
		previous &&
		report.id === previous.id &&
		report.group === previous.group &&
		report.base_revision === previous.base_revision &&
		report.state === "verified" &&
		!report.verification_receipt &&
		previous.verification_receipt
	) {
		report.verification_receipt = previous.verification_receipt;
	}
	const ttl = Math.min(
		600,
		Math.floor((Date.parse(report.expires_at) - Date.now()) / 1000),
	);
	if (ttl < 1) throw new AuthenticationError("interaction_expired");
	await getValkeyClient().set(
		key(actor, report.id),
		JSON.stringify({
			target,
			sessionId: actor.sessionId,
			credentialFingerprint: fingerprint(actor),
			report,
		}),
		"EX",
		ttl,
	);
	return publicCandidateReport(report);
}

export async function forgetCandidateReport(actor: CandidateOwner, id: string) {
	await getValkeyClient().del(key(actor, id));
}

export function parseCandidatePreview(
	payload: unknown,
	candidateId: string,
	providerId: string,
) {
	const parsed = z
		.object({ candidate: reportSchema, verification: previewSchema })
		.safeParse(payload);
	if (
		!parsed.success ||
		parsed.data.candidate.group !== "authentication" ||
		parsed.data.candidate.id !== candidateId ||
		parsed.data.verification.candidate_id !== candidateId ||
		parsed.data.verification.provider_id !== providerId ||
		!parsed.data.candidate.providers.some(
			(provider) => provider.provider_id === providerId,
		) ||
		(parsed.data.candidate.state === "verified" &&
			!parsed.data.candidate.verification_receipt)
	) {
		throw new AuthenticationError("protocol_error");
	}
	return parsed.data;
}

/** Store the bound activation receipt privately; return only a non-provisioning
 * preview. The browser cannot obtain a receipt through the generic proxy. */
export async function preserveCandidatePreview(
	claimed: ClaimedInteraction,
	payload: unknown,
): Promise<unknown> {
	const intent = claimed.intent;
	if (intent.purpose !== "provider_verification")
		throw new AuthenticationError("protocol_error");
	const { candidate, verification } = parseCandidatePreview(
		payload,
		intent.candidateId,
		claimed.providerId,
	);
	const publicCandidate = await preserveCandidateReport(
		intent.actor,
		claimed.target,
		candidate,
	);
	return { candidate: publicCandidate, verification };
}
