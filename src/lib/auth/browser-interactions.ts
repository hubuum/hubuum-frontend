import "server-only";

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backendFetchRaw } from "@/lib/api/backend";
import { discardAdminProbeResponse, probeAdminAccess } from "@/lib/auth/admin";
import {
	getSessionFromRequest,
	SESSION_COOKIE_NAME,
	setSessionCookie,
} from "@/lib/auth/session";
import { SESSION_CLIENT_ID } from "@/lib/auth/session-credentials";
import {
	getBackendTarget,
	sessionCredential,
	type BackendTarget,
} from "@/lib/backend-target";
import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { credentialOperation } from "@/lib/credential-operation";
import { getServerEnv } from "@/lib/env";
import { normalizeReturnPath } from "@/lib/return-path";
import { protectPrivateResponse } from "@/lib/security-policy";
import {
	AuthenticationError,
	authenticationResponseError,
	cleanupInteraction,
	InteractionAccess,
	parseAuthenticationMethods,
	parseInteractionBegun,
	providerIdSchema,
	readAuthenticationResponse,
} from "./interactions-protocol";
import {
	anonymousInteractionBrowser,
	createPendingInteraction,
	type InteractionIntent,
} from "./pending-interactions";

const baseInput = z.object({
	provider_id: providerIdSchema,
	return_path: z.string().max(4096).optional(),
});
const mutationSchema = z
	.object({
		method: z.enum(["POST", "PATCH"]),
		path: z.string().max(512),
		body: z.record(z.string(), z.unknown()),
		ifMatch: z.string().max(256).optional(),
		idempotencyKey: z.string().max(256).optional(),
	})
	.strict();
const beginSchema = z.discriminatedUnion("purpose", [
	baseInput.extend({ purpose: z.literal("login") }).strict(),
	baseInput
		.extend({
			purpose: z.literal("credential_approval"),
			mutation: mutationSchema,
		})
		.strict(),
	baseInput
		.extend({
			purpose: z.literal("provider_verification"),
			candidate_id: z.uuid(),
		})
		.strict(),
]);

export function interactionResponse(
	request: NextRequest,
	payload: unknown,
	status = 200,
): NextResponse {
	const response = NextResponse.json(payload, { status });
	protectPrivateResponse(response.headers);
	response.headers.set("Referrer-Policy", "no-referrer");
	response.headers.set(
		CORRELATION_ID_HEADER,
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
			generateCorrelationId(),
	);
	return response;
}
export function interactionFailure(
	request: NextRequest,
	error: unknown,
): NextResponse {
	const failure =
		error instanceof AuthenticationError
			? error
			: new AuthenticationError("provider_unavailable");
	const response = interactionResponse(
		request,
		{ reason: failure.reason, message: failure.message },
		failure.status,
	);
	if (failure.retryAfter !== undefined)
		response.headers.set("Retry-After", String(failure.retryAfter));
	return response;
}

function browserOrigin(target: BackendTarget): string {
	const env = getServerEnv();
	const value = env.AUTH_BROWSER_ORIGIN ?? target.origin;
	const origin = new URL(value);
	const localDevelopment =
		env.NODE_ENV !== "production" &&
		["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
	if (
		origin.origin !== value ||
		origin.username ||
		origin.password ||
		(origin.protocol !== "https:" &&
			!(origin.protocol === "http:" && localDevelopment))
	)
		throw new AuthenticationError("provider_unavailable");
	return origin.origin;
}

export async function discoverBrowserMethods(
	request: NextRequest,
): Promise<NextResponse> {
	try {
		const target = await getBackendTarget();
		if (!target) throw new AuthenticationError("provider_unavailable");
		const upstream = await backendFetchRaw("/api/v1/auth/methods", {
			target,
			signal: AbortSignal.timeout(10_000),
			correlationId:
				normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
				undefined,
		});
		if (upstream.status === 404) {
			await upstream.body?.cancel();
			return interactionResponse(
				request,
				{
					reason: "interaction_unsupported",
					message: "This server uses the existing password sign-in flow.",
				},
				404,
			);
		}
		const payload = await readAuthenticationResponse(upstream);
		if (!upstream.ok) throw authenticationResponseError(upstream, payload);
		return interactionResponse(request, parseAuthenticationMethods(payload));
	} catch (error) {
		return interactionFailure(request, error);
	}
}

export async function beginBrowserInteraction(
	request: NextRequest,
): Promise<NextResponse> {
	const rejected = rejectCrossOriginBffMutation(request);
	if (rejected) return rejected;
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	let access: InteractionAccess | null = null;
	let target: BackendTarget | null = null;
	try {
		let payload: unknown;
		try {
			payload = await readAuthenticationResponse(request, 64 * 1024);
		} catch {
			return interactionResponse(
				request,
				{
					reason: "invalid_request",
					message: "Invalid bounded authentication request.",
				},
				400,
			);
		}
		const parsed = beginSchema.safeParse(payload);
		if (!parsed.success)
			return interactionResponse(
				request,
				{
					reason: "invalid_request",
					message: "Invalid authentication request.",
				},
				400,
			);
		const input = parsed.data;
		target = await getBackendTarget();
		if (!target) throw new AuthenticationError("provider_unavailable");
		const expectedOrigin = browserOrigin(target);
		const session = await getSessionFromRequest(request);
		let intent: InteractionIntent;
		let operation: ReturnType<typeof credentialOperation> = null;
		if (input.purpose === "login") {
			if (session)
				return interactionResponse(
					request,
					{
						reason: "login_already_active",
						message: "Sign out before starting another sign-in.",
					},
					409,
				);
			intent = { purpose: "login" };
		} else {
			if (!session)
				return interactionResponse(
					request,
					{
						reason: "session_required",
						message: "Sign in before requesting fresh authentication.",
					},
					401,
				);
			const actor = {
				sid: session.sid,
				sessionId: session.sessionId,
				token: session.token,
			};
			if (input.purpose === "credential_approval") {
				operation = credentialOperation(
					input.mutation.method,
					input.mutation.path,
					input.mutation.body,
				);
				if (
					!operation ||
					(operation.kind === "import_credentials" &&
						!input.mutation.idempotencyKey)
				)
					return interactionResponse(
						request,
						{
							reason: "invalid_request",
							message:
								"This prepared mutation does not support browser confirmation.",
						},
						400,
					);
				intent = {
					purpose: input.purpose,
					actor,
					mutation: structuredClone(input.mutation),
				};
			} else {
				const admin = await probeAdminAccess(
					sessionCredential(session),
					correlationId,
				);
				if (admin.status !== "allowed")
					return interactionResponse(
						request,
						{
							reason: "access_denied",
							message:
								"Administrator authentication is required to test a provider.",
						},
						admin.status === "unavailable" ? 503 : 403,
					);
				discardAdminProbeResponse(admin.response);
				intent = {
					purpose: input.purpose,
					actor,
					candidateId: input.candidate_id,
				};
			}
		}
		const browserId =
			session?.sid ??
			(await anonymousInteractionBrowser(
				request.cookies.get(SESSION_COOKIE_NAME)?.value,
			));
		const nonce = randomBytes(32).toString("base64url");
		const upstream = await backendFetchRaw("/api/v1/auth/interactions", {
			target,
			correlationId,
			method: "POST",
			token: session ? sessionCredential(session) : undefined,
			headers: { "Content-Type": "application/json" },
			signal: AbortSignal.timeout(30_000),
			body: JSON.stringify({
				client_id: SESSION_CLIENT_ID,
				provider_id: input.provider_id,
				purpose: input.purpose,
				delivery: "bff",
				interaction_mode: "browser",
				return_target_id: getServerEnv().AUTH_BFF_RETURN_TARGET_ID,
				return_nonce: nonce,
				...(operation ? { operation } : {}),
				...(input.purpose === "provider_verification"
					? { candidate_id: input.candidate_id }
					: {}),
			}),
		});
		const begunPayload = await readAuthenticationResponse(upstream);
		if (upstream.status === 404 && input.purpose === "provider_verification")
			throw new AuthenticationError("configuration_changed");
		if (upstream.status !== 201)
			throw authenticationResponseError(upstream, begunPayload);
		access = InteractionAccess.parse(begunPayload);
		const begun = parseInteractionBegun(begunPayload, expectedOrigin);
		if (!access || begun.next.kind !== "browser")
			throw new AuthenticationError("protocol_error");
		await createPendingInteraction({
			...access.store(),
			providerId: input.provider_id,
			browserId,
			nonce,
			target,
			intent,
			returnPath: normalizeReturnPath(input.return_path),
			expiresAt: Date.parse(begun.expires_at),
			intervalSeconds: begun.interval_seconds,
		});
		const response = interactionResponse(
			request,
			{
				id: begun.id,
				nonce,
				purpose: input.purpose,
				expires_at: begun.expires_at,
				interval_seconds: begun.interval_seconds,
				next: begun.next,
			},
			201,
		);
		if (!session)
			setSessionCookie(
				response,
				browserId,
				Date.parse(begun.expires_at),
				request,
			);
		return response;
	} catch (error) {
		if (
			access &&
			target &&
			!(await cleanupInteraction(target, access, correlationId))
		)
			return interactionResponse(
				request,
				{
					reason: "cleanup_unconfirmed",
					message:
						"Authentication stopped; cleanup could not be confirmed. Use local recovery administration before retrying.",
					interaction_id: access.id,
				},
				503,
			);
		return interactionFailure(request, error);
	}
}

export { cleanupInteraction } from "./interactions-protocol";
