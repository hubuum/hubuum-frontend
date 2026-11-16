import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backendFetchRaw } from "@/lib/api/backend";
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
import {
	securityCandidateError,
	securityCandidateInput,
} from "@/lib/security-candidate";
import { discardAdminProbeResponse, probeAdminAccess } from "./admin";
import { interactionResponse } from "./browser-interactions";
import {
	forgetCandidateReport,
	loadCandidateReport,
	parseCandidatePreview,
	parseCandidateReport,
	preserveCandidateReport,
} from "./candidate-verification";
import {
	AuthenticationError,
	readAuthenticationResponse,
} from "./interactions-protocol";
import { getSessionFromRequest, type ActiveSession } from "./session";

const root = "/api/v1/admin/runtime-settings/security-candidates";
class CandidateError extends Error {
	constructor(readonly status: number) {
		super(securityCandidateError(status));
	}
}
async function input(request: NextRequest): Promise<unknown> {
	try {
		return await readAuthenticationResponse(request, 256 * 1024);
	} catch {
		throw new CandidateError(400);
	}
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw new CandidateError(400);
	return result.data;
}
type Authority = {
	actor: ActiveSession;
	target: BackendTarget;
	correlationId: string;
};
async function authority(request: NextRequest): Promise<Authority> {
	const target = await getBackendTarget();
	if (!target) throw new CandidateError(503);
	const actor = await getSessionFromRequest(request);
	if (!actor) throw new CandidateError(401);
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	const probe = await probeAdminAccess(sessionCredential(actor), correlationId);
	if (probe.status !== "allowed")
		throw new CandidateError(probe.status === "unavailable" ? 503 : 403);
	discardAdminProbeResponse(probe.response);
	return { actor, target, correlationId };
}
async function upstream(
	auth: Authority,
	path: string,
	body?: unknown,
	headers?: Record<string, string>,
) {
	const response = await backendFetchRaw(path, {
		target: auth.target,
		token: sessionCredential(auth.actor),
		correlationId: auth.correlationId,
		method: body === undefined ? "GET" : "POST",
		signal: AbortSignal.timeout(125_000),
		headers:
			body === undefined
				? undefined
				: { "Content-Type": "application/json", ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new CandidateError(response.status);
	}
	return readAuthenticationResponse(response, 1024 * 1024);
}
function failure(
	request: NextRequest,
	error: unknown,
	action?: "report" | "ldap" | "activate" | "discard",
): NextResponse {
	const status =
		error instanceof CandidateError
			? error.status
			: error instanceof AuthenticationError
				? error.status
				: 503;
	return interactionResponse(
		request,
		{
			reason: [409, 410, 412].includes(status)
				? "candidate_changed"
				: status === 400
					? "invalid_request"
					: "candidate_unavailable",
			message:
				action === "ldap" && status === 401
					? "Test sign-in failed. Check the test credentials and provider settings. Live authentication has not changed."
					: action === "activate" && status === 401
						? "Fresh local approval failed. Check your password and session before trying again."
						: securityCandidateError(status),
		},
		status,
	);
}

export async function createSecurityCandidate(
	request: NextRequest,
): Promise<NextResponse> {
	const rejected = rejectCrossOriginBffMutation(request);
	if (rejected) return rejected;
	try {
		const auth = await authority(request);
		const body = parse(securityCandidateInput, await input(request));
		const report = parseCandidateReport(await upstream(auth, root, body));
		if (
			report.group !== body.group ||
			report.base_revision !== body.expected_revision
		)
			throw new AuthenticationError("protocol_error");
		const visible = await preserveCandidateReport(
			auth.actor,
			auth.target,
			report,
		);
		return interactionResponse(request, visible, 201);
	} catch (error) {
		return failure(request, error);
	}
}

export async function securityCandidateAction(
	request: NextRequest,
	candidateId: string,
	action: "report" | "ldap" | "activate" | "discard",
): Promise<NextResponse> {
	if (action !== "report") {
		const rejected = rejectCrossOriginBffMutation(request);
		if (rejected) return rejected;
	}
	try {
		const id = parse(z.uuid(), candidateId);
		const auth = await authority(request);
		const candidate = await loadCandidateReport(auth.actor, auth.target, id);
		if (action === "discard") {
			await forgetCandidateReport(auth.actor, id);
			return interactionResponse(request, { discarded: true });
		}
		if (action === "report") {
			const visible = await preserveCandidateReport(
				auth.actor,
				auth.target,
				await upstream(auth, `${root}/${id}`),
				candidate,
			);
			return interactionResponse(request, visible);
		}
		if (action === "ldap") {
			const body = parse(
				z
					.object({
						provider_id: z.uuid(),
						username: z.string().min(1).max(255),
						password: z.string().min(1).max(4096),
					})
					.strict(),
				await input(request),
			);
			if (
				!candidate.providers.some(
					(provider) =>
						provider.provider_id === body.provider_id &&
						provider.kind === "ldap",
				)
			)
				throw new CandidateError(400);
			const preview = parseCandidatePreview(
				await upstream(auth, `${root}/${id}/verify-ldap`, body),
				id,
				body.provider_id,
			);
			const visible = await preserveCandidateReport(
				auth.actor,
				auth.target,
				preview.candidate,
			);
			return interactionResponse(request, {
				candidate: visible,
				verification: preview.verification,
			});
		}
		const body = parse(
			z
				.object({
					expected_revision: z.number().int().positive().safe(),
					password: z.string().min(1).max(4096),
				})
				.strict(),
			await input(request),
		);
		if (
			body.expected_revision !== candidate.base_revision ||
			candidate.state !== "verified" ||
			!candidate.verification_receipt
		)
			throw new CandidateError(412);
		// The browser supplies neither the receipt nor the approval operation.
		// Bind both server-held authorities to this exact candidate and revision.
		const approved = z
			.object({ approval: z.string().regex(/^hca1\.[a-f0-9]{64}$/) })
			.safeParse(
				await upstream(auth, "/api/v1/iam/credential-approvals", {
					password: body.password,
					operation: {
						kind: "activate_security_candidate",
						candidate_id: id,
						group: candidate.group,
						expected_revision: candidate.base_revision,
					},
				}),
			);
		if (!approved.success) throw new AuthenticationError("protocol_error");
		const activated = z
			.object({
				group: z.enum(["authentication", "authorization"]),
				revision: z.number().int().positive().safe(),
				changed: z.boolean(),
			})
			.safeParse(
				await upstream(
					auth,
					`${root}/${id}/activate`,
					{
						expected_revision: candidate.base_revision,
						verification_receipt: candidate.verification_receipt,
					},
					{ "X-Hubuum-Credential-Approval": approved.data.approval },
				),
			);
		if (
			!activated.success ||
			activated.data.group !== candidate.group ||
			activated.data.revision < candidate.base_revision
		)
			throw new AuthenticationError("protocol_error");
		await forgetCandidateReport(auth.actor, id);
		return interactionResponse(request, activated.data);
	} catch (error) {
		return failure(request, error, action);
	}
}
