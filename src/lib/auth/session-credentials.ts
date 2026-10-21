import "server-only";

import { z } from "zod";
import type { SessionResponse } from "@/lib/api/generated/models";

export const SESSION_CLIENT_ID = "hubuum-frontend";

const responseSchema = z.object({
	session_id: z.uuid(),
	token_type: z.literal("Bearer"),
	access_token: z.string().min(1),
	refresh_token: z.string().min(1),
	access_expires_at: z.iso.datetime({ offset: true }),
	refresh_expires_at: z.iso.datetime({ offset: true }),
	absolute_expires_at: z.iso.datetime({ offset: true }),
});

export function parseSessionResponse(value: unknown): SessionResponse | null {
	const parsed = responseSchema.safeParse(value);
	if (!parsed.success) return null;
	const result = parsed.data;
	const access = Date.parse(result.access_expires_at);
	const refresh = Date.parse(result.refresh_expires_at);
	const absolute = Date.parse(result.absolute_expires_at);
	if (
		result.access_token === result.refresh_token ||
		access <= Date.now() ||
		access > refresh ||
		refresh > absolute
	)
		return null;
	return result;
}

export const sessionPayloadSchema = z.object({
	token: z.string().min(1),
	refreshToken: z.string().min(1),
	sessionId: z.uuid(),
	clientId: z.literal(SESSION_CLIENT_ID),
	accessExpiresAt: z.number().finite(),
	refreshExpiresAt: z.number().finite(),
	absoluteExpiresAt: z.number().finite(),
	refreshAt: z.number().finite(),
	generation: z.uuid(),
	refreshing: z.uuid().optional(),
	username: z.string().optional(),
	createdAt: z.number().finite(),
	lastSeen: z.number().finite(),
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

export function sessionPayload(
	credentials: SessionResponse,
	username?: string,
): SessionPayload {
	const now = Date.now();
	const accessExpiresAt = Date.parse(credentials.access_expires_at);
	return {
		token: credentials.access_token,
		refreshToken: credentials.refresh_token,
		sessionId: credentials.session_id,
		clientId: SESSION_CLIENT_ID,
		accessExpiresAt,
		refreshExpiresAt: Date.parse(credentials.refresh_expires_at),
		absoluteExpiresAt: Date.parse(credentials.absolute_expires_at),
		refreshAt: accessExpiresAt - Math.min(30_000, (accessExpiresAt - now) / 10),
		generation: crypto.randomUUID(),
		username,
		createdAt: now,
		lastSeen: now,
	};
}

export function sessionTtlSeconds(
	payload: SessionPayload,
	configuredTtl: number,
): number {
	return Math.max(
		0,
		Math.min(
			configuredTtl,
			Math.floor(
				(Math.min(payload.refreshExpiresAt, payload.absoluteExpiresAt) -
					Date.now()) /
					1000,
			),
		),
	);
}
