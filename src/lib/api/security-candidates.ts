import { z } from "zod";
import type { SecurityCandidateRequest } from "@/lib/api/generated/models";
import { frontendApiPath } from "@/lib/api/frontend";
import { securityCandidateError } from "@/lib/security-candidate";

export const publicCandidateSchema = z
	.object({
		id: z.uuid(),
		group: z.enum(["authentication", "authorization"]),
		base_revision: z.number().int().positive().safe(),
		expires_at: z.iso.datetime({ offset: true }),
		state: z.enum(["unverified", "verified", "failed", "expired"]),
		providers: z
			.array(
				z
					.object({
						provider_id: z.uuid(),
						name: z.string().max(160),
						kind: z.enum(["ldap", "oidc", "oauth"]),
					})
					.strict(),
			)
			.max(256),
		checks: z
			.array(
				z
					.object({
						kind: z.string().max(256),
						status: z.string().max(128),
						provider_id: z.uuid().nullable().optional(),
						reason: z.string().max(512).nullable().optional(),
					})
					.strict(),
			)
			.max(2048),
	})
	.strict();
export type PublicCandidate = z.infer<typeof publicCandidateSchema>;
export const publicPreviewSchema = z
	.object({
		candidate: publicCandidateSchema,
		verification: z
			.object({
				provider_id: z.uuid(),
				candidate_id: z.uuid(),
				subject: z.string().max(4096),
				admitted: z.boolean(),
				groups: z
					.array(
						z
							.object({ key: z.string().max(4096), name: z.string().max(4096) })
							.strict(),
					)
					.max(2048),
				membership: z.string().max(256),
				issued_session: z.literal(false),
				provisioned: z.literal(false),
			})
			.strict(),
	})
	.strict();
export type PublicPreview = z.infer<typeof publicPreviewSchema>["verification"];

export class CandidateRequestError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}
const root = "/admin/security-candidates";
async function send(
	path: string,
	body?: unknown,
	method = body === undefined ? "GET" : "POST",
) {
	const response = await fetch(frontendApiPath(path), {
		method,
		credentials: "include",
		cache: "no-store",
		headers:
			body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const error = z
			.object({ message: z.string().max(1024) })
			.safeParse(payload);
		throw new CandidateRequestError(
			response.status,
			error.success
				? error.data.message
				: securityCandidateError(response.status),
		);
	}
	return payload;
}
export async function createCandidate(body: SecurityCandidateRequest) {
	return publicCandidateSchema.parse(await send(root, body));
}
export async function readCandidate(id: string) {
	return publicCandidateSchema.parse(
		await send(`${root}/${z.uuid().parse(id)}`),
	);
}
export async function verifyLdapCandidate(
	id: string,
	providerId: string,
	username: string,
	password: string,
) {
	const preview = publicPreviewSchema.parse(
		await send(`${root}/${z.uuid().parse(id)}/verify-ldap`, {
			provider_id: providerId,
			username,
			password,
		}),
	);
	if (
		preview.candidate.id !== id ||
		preview.verification.candidate_id !== id ||
		preview.verification.provider_id !== providerId
	)
		throw new Error("The provider verification result could not be confirmed.");
	return preview;
}
export async function activateCandidate(
	id: string,
	expectedRevision: number,
	password: string,
) {
	return z
		.object({
			group: z.enum(["authentication", "authorization"]),
			revision: z.number().int().positive().safe(),
			changed: z.boolean(),
		})
		.strict()
		.parse(
			await send(`${root}/${z.uuid().parse(id)}/activate`, {
				expected_revision: expectedRevision,
				password,
			}),
		);
}
export async function discardCandidate(id: string) {
	await send(`${root}/${z.uuid().parse(id)}`, undefined, "DELETE");
}
