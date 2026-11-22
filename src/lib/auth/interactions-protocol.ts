import "server-only";

import { z } from "zod";
import { backendFetchRaw } from "@/lib/api/backend";
import type {
	AuthenticationMethods,
	InteractionBegun,
} from "@/lib/api/generated/models";
import type { BackendTarget } from "@/lib/backend-target";

export const providerIdSchema = z.union([
	z.literal("local"),
	z
		.string()
		.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
		.refine((id) => id !== "00000000-0000-0000-0000-000000000000"),
]);
const idSchema = z
	.uuid()
	.refine(
		(id) =>
			id === id.toLowerCase() && id !== "00000000-0000-0000-0000-000000000000",
	);
const accessSchema = z.object({
	id: idSchema,
	redemption_secret: z.string().regex(/^hai1\.[0-9a-f]{64}$/),
});
const begunSchema = accessSchema.extend({
	interaction_version: z.literal(1),
	expires_at: z.iso.datetime({ offset: true }),
	interval_seconds: z.number().int().min(1).max(60),
	next: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("credentials") }),
		z.object({
			kind: z.literal("browser"),
			verification_uri: z.string().url(),
			user_code: z
				.string()
				.min(1)
				.max(128)
				.regex(/^\P{Cc}+$/u),
		}),
	]),
});
const methodsSchema = z.object({
	interaction_version: z.literal(1),
	methods: z
		.array(
			z.object({
				provider_id: providerIdSchema,
				name: z.string().min(1).max(160),
				kind: z.enum(["local", "ldap", "oidc", "oauth"]),
				interaction: z.enum(["credentials", "browser"]),
				fresh_authentication: z.boolean(),
				browser_available: z.boolean(),
			}),
		)
		.max(256),
});

const outcomes = {
	access_denied: [403, "Authentication was denied."],
	interaction_cancelled: [403, "Authentication was cancelled."],
	interaction_expired: [410, "Authentication expired. Begin again."],
	interaction_consumed: [
		409,
		"Completion was already used. Check the result before starting again.",
	],
	interaction_failed: [409, "Authentication stopped. Begin again."],
	configuration_changed: [
		409,
		"Authentication configuration changed. Begin again.",
	],
	interaction_pending: [409, "Authentication is not ready."],
	interaction_invalid: [401, "Invalid authentication interaction."],
	capability_unsupported: [
		422,
		"This provider does not support the requested operation.",
	],
	provider_unavailable: [
		503,
		"The authentication provider is temporarily unavailable.",
	],
	slow_down: [429, "Wait before checking authentication again."],
	protocol_error: [
		502,
		"The authentication server returned an invalid response.",
	],
} as const;
export type AuthenticationOutcome = keyof typeof outcomes;

export class AuthenticationError extends Error {
	readonly status: number;
	constructor(
		readonly reason: AuthenticationOutcome,
		readonly retryAfter?: number,
	) {
		super(outcomes[reason][1]);
		this.status = outcomes[reason][0];
	}
}

/** Validated redemption authority; never pass its representation to browser code. */
export class InteractionAccess {
	readonly #secret: string;
	private constructor(
		readonly id: string,
		secret: string,
	) {
		this.#secret = secret;
	}
	static parse(value: unknown): InteractionAccess | null {
		const parsed = accessSchema.safeParse(value);
		return parsed.success
			? new InteractionAccess(parsed.data.id, parsed.data.redemption_secret)
			: null;
	}
	store(): { id: string; redemption_secret: string } {
		return { id: this.id, redemption_secret: this.#secret };
	}
	headers(): Record<string, string> {
		return { Authorization: `Hubuum-Interaction ${this.#secret}` };
	}
}

export function parseInteractionBegun(
	value: unknown,
	browserOrigin: string,
): InteractionBegun {
	const parsed = begunSchema.safeParse(value);
	if (!parsed.success) throw new AuthenticationError("protocol_error");
	const begun = parsed.data;
	const remaining = Date.parse(begun.expires_at) - Date.now();
	if (remaining <= 0 || remaining > 10 * 60_000)
		throw new AuthenticationError("protocol_error");
	if (begun.next.kind === "browser") {
		const uri = new URL(begun.next.verification_uri);
		if (
			uri.origin !== browserOrigin ||
			uri.username ||
			uri.password ||
			uri.search ||
			uri.hash ||
			uri.pathname !== "/api/v1/auth/interactions/browser"
		)
			throw new AuthenticationError("protocol_error");
	}
	return begun;
}

export function parseAuthenticationMethods(
	value: unknown,
): AuthenticationMethods {
	const parsed = methodsSchema.safeParse(value);
	if (
		!parsed.success ||
		new Set(parsed.data.methods.map((method) => method.provider_id)).size !==
			parsed.data.methods.length
	)
		throw new AuthenticationError("protocol_error");
	return parsed.data;
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
export async function readAuthenticationResponse(
	response: Response | Request,
	maximumBytes = MAX_RESPONSE_BYTES,
): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) throw new AuthenticationError("protocol_error");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > maximumBytes) {
				await reader.cancel();
				throw new AuthenticationError("protocol_error");
			}
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} catch {
		throw new AuthenticationError("protocol_error");
	} finally {
		reader.releaseLock();
	}
}

/** One bounded request. Redemption uses only its capability, never a saved bearer. */
export async function interactionRequest(
	target: BackendTarget,
	access: InteractionAccess,
	action: "status" | "complete" | "cancel" | "issued-session/revoke",
	correlationId: string,
): Promise<unknown> {
	const response = await backendFetchRaw(
		`/api/v1/auth/interactions/${access.id}/${action}`,
		{
			target,
			correlationId,
			method: "POST",
			headers: { ...access.headers(), "Content-Type": "application/json" },
			body: JSON.stringify({ client_id: "hubuum-frontend" }),
			signal: AbortSignal.timeout(
				action === "cancel" || action === "issued-session/revoke"
					? 5_000
					: 30_000,
			),
		},
	);
	if (response.status === 204) return null;
	const payload = await readAuthenticationResponse(response);
	if (!response.ok) throw authenticationResponseError(response, payload);
	return payload;
}

export function authenticationResponseError(
	response: Response,
	payload: unknown,
): AuthenticationError {
	const reason = z.object({ reason: z.string() }).safeParse(payload);
	const key =
		reason.success && Object.hasOwn(outcomes, reason.data.reason)
			? (reason.data.reason as AuthenticationOutcome)
			: "protocol_error";
	const raw = response.headers.get("retry-after");
	const delay =
		raw && /^\d+$/.test(raw)
			? Number(raw)
			: raw
				? Math.ceil((Date.parse(raw) - Date.now()) / 1000)
				: undefined;
	// A delay beyond the maximum interaction lifetime must not become an early retry.
	return new AuthenticationError(
		key,
		delay !== undefined
			? Math.max(1, Math.min(Number.isFinite(delay) ? delay : 601, 601))
			: undefined,
	);
}

/** Cancel first so an in-flight completion cannot issue after the cleanup read. */
export async function cleanupInteraction(
	target: BackendTarget,
	access: InteractionAccess,
	correlationId: string,
): Promise<boolean> {
	try {
		try {
			await interactionRequest(target, access, "cancel", correlationId);
		} catch (error) {
			if (
				!(error instanceof AuthenticationError) ||
				![
					"interaction_consumed",
					"configuration_changed",
					"interaction_failed",
					"interaction_expired",
					"interaction_cancelled",
					"access_denied",
				].includes(error.reason)
			)
				return false;
		}
		try {
			await interactionRequest(
				target,
				access,
				"issued-session/revoke",
				correlationId,
			);
		} catch (error) {
			// An exact no-session result is safe only after cancellation was fenced.
			if (
				!(error instanceof AuthenticationError) ||
				error.reason !== "interaction_pending"
			)
				return false;
		}
		return true;
	} catch {
		return false;
	}
}
