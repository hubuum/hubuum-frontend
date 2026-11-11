import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";
import { type BackendTarget, sessionCredential } from "@/lib/backend-target";
import {
	parseSessionResponse,
	sessionPayload,
	type SessionPayload,
} from "./session-credentials";
import type { SessionStore } from "./session-store";

async function revokeUnstoredAccess(
	token: string,
	target?: BackendTarget,
): Promise<void> {
	await backendFetchRaw("/api/v1/auth/logout", {
		method: "POST",
		token,
		target,
		signal: AbortSignal.timeout(2_000),
	}).catch(() => undefined);
}

// Independent callers (including other pods) coordinate entirely through Valkey.
export async function refreshSession(
	store: SessionStore,
	sid: string,
	initial: SessionPayload,
): Promise<SessionPayload | null> {
	const credential = sessionCredential(initial);
	const target = typeof credential === "object" ? credential.target : undefined;
	let current: SessionPayload | null = initial;
	const deadline = Date.now() + 10_000;
	while (current && Date.now() < deadline) {
		if (
			Math.min(current.refreshExpiresAt, current.absoluteExpiresAt) <=
			Date.now()
		) {
			await store.invalidateGeneration(sid, current.generation);
			return null;
		}
		if (!current.refreshing && Date.now() < current.refreshAt) return current;
		if (current.refreshing) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			current = await store.get(sid);
			continue;
		}
		const owner = crypto.randomUUID();
		if (!(await store.claimRefresh(sid, current.generation, owner))) {
			current = await store.get(sid);
			continue;
		}
		let issuedToken: string | undefined;
		try {
			const response = await backendFetchRaw("/api/v1/auth/refresh", {
				target,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					client_id: current.clientId,
					refresh_token: current.refreshToken,
				}),
				signal: AbortSignal.timeout(8_000),
			});
			const pair = response.ok
				? parseSessionResponse(await response.json())
				: null;
			issuedToken = pair?.access_token;
			if (
				!pair ||
				pair.session_id !== current.sessionId ||
				Date.parse(pair.absolute_expires_at) !== current.absoluteExpiresAt ||
				pair.refresh_token === current.refreshToken
			) {
				throw new Error("Session rotation rejected");
			}
			const next = {
				...sessionPayload(pair, current.username),
				backendOrigin: target?.origin ?? current.backendOrigin,
				backendRevision: target?.revision ?? current.backendRevision,
				createdAt: current.createdAt,
			};
			if (await store.completeRefresh(sid, current.generation, owner, next))
				return next;
		} catch {
			// Never retry an uncertain single-use refresh or log request/response data.
			console.warn(
				"[hubuum-auth] session refresh failed; reauthentication required",
			);
		}
		await store.invalidateGeneration(sid, current.generation);
		if (issuedToken) await revokeUnstoredAccess(issuedToken, target);
		return null;
	}
	if (current) await store.invalidateGeneration(sid, current.generation);
	return null;
}
