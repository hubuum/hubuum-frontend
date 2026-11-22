import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backendFetchRaw } from "@/lib/api/backend";
import {
	createSession,
	destroySession,
	getSessionFromRequest,
	readInteractionSessionBinding,
	SESSION_COOKIE_NAME,
	setSessionCookie,
} from "@/lib/auth/session";
import { parseSessionResponse } from "@/lib/auth/session-credentials";
import { getBackendTarget } from "@/lib/backend-target";
import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { credentialOperation } from "@/lib/credential-operation";
import {
	formatScopedIdentityName,
	readAuthenticatedPrincipalIdentity,
} from "@/lib/identity-scopes";
import {
	cleanupInteraction,
	interactionFailure,
	interactionResponse,
} from "./browser-interactions";
import { preserveCandidatePreview } from "./candidate-verification";
import {
	AuthenticationError,
	interactionRequest,
	readAuthenticationResponse,
} from "./interactions-protocol";
import {
	ClaimedInteraction,
	CompletedLoginHandoff,
	OwnedInteractionPoll,
	readInteractionResult,
} from "./pending-interactions";

const approvalSchema = z.object({
	approval: z.string().regex(/^hca1\.[0-9a-f]{64}$/),
	record: z.object({ id: z.number().int().positive() }),
	token_expires_at: z.iso.datetime({ offset: true, local: true }).nullable().optional(),
});

async function performApprovedMutation(
	claimed: ClaimedInteraction,
	payload: unknown,
	correlationId: string,
): Promise<unknown> {
	const intent = claimed.intent;
	const parsed = approvalSchema.safeParse(payload);
	if (intent.purpose !== "credential_approval" || !parsed.success)
		throw new AuthenticationError("protocol_error");
	const mutation = intent.mutation;
	const operation = credentialOperation(
		mutation.method,
		mutation.path,
		mutation.body,
	);
	if (!operation) throw new AuthenticationError("protocol_error");
	if (operation.kind === "create_token" || operation.kind === "renew_token") {
		if (!parsed.data.token_expires_at)
			throw new AuthenticationError("protocol_error");
		// Preserve the server's exact microseconds; Date round trips lose precision.
		mutation.body.expires_at = parsed.data.token_expires_at;
	}
	const headers = new Headers({
		"Content-Type": "application/json",
		"X-Hubuum-Credential-Approval": parsed.data.approval,
	});
	if (mutation.ifMatch) headers.set("If-Match", mutation.ifMatch);
	if (mutation.idempotencyKey)
		headers.set("Idempotency-Key", mutation.idempotencyKey);
	try {
		const upstream = await backendFetchRaw(mutation.path, {
			target: claimed.target,
			correlationId,
			method: mutation.method,
			headers,
			token: intent.actor.token,
			body: JSON.stringify(mutation.body),
			signal: AbortSignal.timeout(30_000),
		});
		if (!upstream.ok) {
			await upstream.body?.cancel();
			return {
				status: upstream.status,
				body: {
					reason: "operation_failed",
					message:
						"The protected operation was rejected. Review the current state before requesting a new approval.",
					approval_id: parsed.data.record.id,
				},
			};
		}
		const result = [204, 205].includes(upstream.status)
			? null
			: await readAuthenticationResponse(upstream);
		return { status: upstream.status, body: result };
	} catch {
		return {
			status: 502,
			body: {
				reason: "operation_outcome_unknown",
				message:
					"The result could not be confirmed. Check the affected account, task or restore before retrying. The operation may have completed.",
				approval_id: parsed.data.record.id,
			},
		};
	}
}

function redirectTo(location: string): NextResponse {
	return new NextResponse(null, {
		status: 303,
		headers: {
			Location: location,
			"Cache-Control": "private, no-store",
			"Referrer-Policy": "no-referrer",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

async function completeInteraction(
	request: NextRequest,
	mode: "navigation" | "json",
): Promise<NextResponse> {
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	let claimed: ClaimedInteraction | null = null;
	let newSession: string | null = null;
	let finished = false;
	let mutationMayHaveCompleted = false;
	try {
		const query = request.nextUrl.searchParams;
		if (Array.from(query.keys()).sort().join(",") !== "interaction_id,nonce")
			throw new AuthenticationError("interaction_invalid");
		const id = query.get("interaction_id"),
			nonce = query.get("nonce");
		const browserId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
		const target = await getBackendTarget();
		if (!id || !nonce || !browserId || !target)
			throw new AuthenticationError("interaction_invalid");
		const handoff = await CompletedLoginHandoff.acquire(id, {
			browserId,
			nonce,
			target,
		});
		if (handoff) {
			const headers = new Headers(request.headers);
			headers.set("Cookie", `${SESSION_COOKIE_NAME}=${handoff.sid}`);
			const resumed = await getSessionFromRequest(
				new NextRequest(request.url, { headers }),
			);
			if (!resumed) throw new AuthenticationError("interaction_expired");
			const response =
				mode === "navigation"
					? redirectTo(handoff.returnPath)
					: interactionResponse(request, {
							state: "finished",
							purpose: "login",
							result: { authenticated: true },
							return_path: handoff.returnPath,
						});
			setSessionCookie(
				response,
				resumed.sid,
				Math.min(resumed.refreshExpiresAt, resumed.absoluteExpiresAt),
				request,
			);
			return response;
		}
		const session = await readInteractionSessionBinding(request, target);
		claimed = await ClaimedInteraction.acquire(id, {
			browserId,
			nonce,
			target,
			sessionId: session?.sessionId,
		});
		const intent = claimed.intent;
		if (intent.purpose === "login" && session)
			throw new AuthenticationError("interaction_invalid");
		const payload = await interactionRequest(
			claimed.target,
			claimed.access,
			"complete",
			correlationId,
		);
		if (intent.purpose === "login") {
			const pair = parseSessionResponse(payload);
			if (!pair) throw new AuthenticationError("protocol_error");
			const me = await backendFetchRaw("/api/v1/iam/me", {
				target: claimed.target,
				token: pair.access_token,
				correlationId,
				signal: AbortSignal.timeout(10_000),
			});
			const identity = me.ok
				? readAuthenticatedPrincipalIdentity(
						await readAuthenticationResponse(me),
					)
				: null;
			if (!identity) throw new AuthenticationError("protocol_error");
			newSession = await createSession(
				pair,
				formatScopedIdentityName(identity.identityScope, identity.name),
				claimed.target,
			);
			await claimed.finish(newSession, { authenticated: true });
			const response =
				mode === "navigation"
					? redirectTo(claimed.returnPath)
					: interactionResponse(request, {
							state: "finished",
							purpose: "login",
							result: { authenticated: true },
							return_path: claimed.returnPath,
						});
			setSessionCookie(
				response,
				newSession,
				Math.min(
					Date.parse(pair.refresh_expires_at),
					Date.parse(pair.absolute_expires_at),
				),
				request,
			);
			finished = true;
			return response;
		}
		mutationMayHaveCompleted = intent.purpose === "credential_approval";
		const result =
			intent.purpose === "credential_approval"
				? await performApprovedMutation(claimed, payload, correlationId)
				: await preserveCandidatePreview(claimed, payload);
		await claimed.finish(browserId, result);
		finished = true;
		if (mode === "json")
			return interactionResponse(
				request,
				await readInteractionResult(claimed.id, {
					browserId,
					nonce,
					target,
					sessionId: session?.sessionId,
				}),
			);
		const location = new URL(claimed.returnPath, "https://console.invalid");
		location.searchParams.set("authentication_result", claimed.id);
		return redirectTo(`${location.pathname}${location.search}${location.hash}`);
	} catch (error) {
		if (newSession && !finished)
			await destroySession(newSession).catch(() => undefined);
		if (
			claimed &&
			!finished &&
			!(await cleanupInteraction(claimed.target, claimed.access, correlationId))
		)
			return interactionResponse(
				request,
				{
					reason: "cleanup_unconfirmed",
					message:
						"Authentication stopped; cleanup could not be confirmed. Use local recovery administration before starting again.",
					interaction_id: claimed.id,
				},
				503,
			);
		const response = mutationMayHaveCompleted
			? interactionResponse(
					request,
					{
						reason: "operation_outcome_unknown",
						message:
							"The protected operation may have completed. Review the affected account, task or restore before retrying.",
						interaction_id: claimed?.id,
					},
					502,
				)
			: interactionFailure(request, error);
		if (claimed && !finished) {
			await claimed
				.finish(claimed.browserId, {
					status: response.status,
					body: await response.clone().json(),
				})
				.catch(() => undefined);
		}
		return response;
	}
}

export async function completeBrowserInteraction(
	request: NextRequest,
): Promise<NextResponse> {
	return completeInteraction(request, "navigation");
}

export async function browserInteractionResult(
	request: NextRequest,
	id: string,
): Promise<NextResponse> {
	const rejected = rejectCrossOriginBffMutation(request);
	if (rejected) return rejected;
	try {
		const input = z
			.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
			.strict()
			.safeParse(await readAuthenticationResponse(request, 1024));
		if (!input.success) throw new AuthenticationError("interaction_invalid");
		const browserId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
		const target = await getBackendTarget();
		if (!browserId || !target)
			throw new AuthenticationError("interaction_invalid");
		const session = await readInteractionSessionBinding(request, target);
		const binding = {
			browserId,
			nonce: input.data.nonce,
			target,
			sessionId: session?.sessionId,
		};
		const callback = request.nextUrl.clone();
		callback.pathname = "/_hubuum-bff/auth/interactions/return";
		callback.search = new URLSearchParams({
			interaction_id: id,
			nonce: input.data.nonce,
		}).toString();
		const resume = () =>
			completeInteraction(
				new NextRequest(callback, { headers: request.headers }),
				"json",
			);
		if (await CompletedLoginHandoff.acquire(id, binding)) return resume();
		let result: Awaited<ReturnType<typeof readInteractionResult>>;
		try {
			result = await readInteractionResult(id, binding);
		} catch (error) {
			if (await CompletedLoginHandoff.acquire(id, binding)) return resume();
			throw error;
		}
		if (result.state === "finished")
			return interactionResponse(request, result);
		let poll: OwnedInteractionPoll;
		try {
			poll = await OwnedInteractionPoll.acquire(id, binding);
		} catch (error) {
			if (await CompletedLoginHandoff.acquire(id, binding)) return resume();
			const finished = await readInteractionResult(id, binding);
			if (finished.state === "finished")
				return interactionResponse(request, finished);
			throw error;
		}
		const state = await poll.poll(
			normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
				generateCorrelationId(),
		);
		if (state.state === "pending" || state.state === "claimed") {
			const response = interactionResponse(request, {
				...result,
				interval_seconds: state.retryAfter,
			});
			response.headers.set("Retry-After", String(state.retryAfter));
			return response;
		}
		if (state.state === "terminal" && state.error.reason === "protocol_error") {
			const cancelled = await cancelBrowserInteraction(
				new NextRequest(request.url, {
					method: "POST",
					headers: request.headers,
					body: JSON.stringify(input.data),
				}),
				id,
			);
			return cancelled.ok
				? interactionFailure(request, state.error)
				: cancelled;
		}
		return resume();
	} catch (error) {
		return interactionFailure(request, error);
	}
}

export async function cancelBrowserInteraction(
	request: NextRequest,
	id: string,
): Promise<NextResponse> {
	const rejected = rejectCrossOriginBffMutation(request);
	if (rejected) return rejected;
	try {
		const input = z
			.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
			.strict()
			.safeParse(await readAuthenticationResponse(request, 1024));
		const browserId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
		const target = await getBackendTarget();
		if (!input.success || !browserId || !target)
			throw new AuthenticationError("interaction_invalid");
		const session = await readInteractionSessionBinding(request, target);
		const claimed = await ClaimedInteraction.acquire(id, {
			browserId,
			nonce: input.data.nonce,
			target,
			sessionId: session?.sessionId,
		});
		if (
			!(await cleanupInteraction(
				claimed.target,
				claimed.access,
				normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
					generateCorrelationId(),
			))
		)
			return interactionResponse(
				request,
				{
					reason: "cleanup_unconfirmed",
					message:
						"Cancellation cleanup could not be confirmed. Use local recovery administration before starting again.",
					interaction_id: claimed.id,
				},
				503,
			);
		await claimed.finish(browserId, { cancelled: true });
		return interactionResponse(request, { state: "cancelled" });
	} catch (error) {
		return interactionFailure(request, error);
	}
}
