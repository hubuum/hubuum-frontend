import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { backendFetchRaw } from "@/lib/api/backend";
import { getApiErrorMessage } from "@/lib/api/errors";
import { copySafeUpstreamResponseHeaders } from "@/lib/api/proxy-response-headers";
import { validateBackendSession } from "@/lib/auth/backend-session-validation";
import {
	clearSessionCookie,
	destroySession,
	getSessionFromRequest,
} from "@/lib/auth/session";
import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { credentialOperation } from "@/lib/credential-operation";
import { protectPrivateResponse } from "@/lib/security-policy";

const mutationSchema = z.object({
	password: z.string().min(1),
	method: z.enum(["POST", "PATCH"]),
	path: z.string(),
	body: z.record(z.string(), z.unknown()),
	ifMatch: z.string().nullable().optional(),
	idempotencyKey: z.string().nullable().optional(),
});
const approvalSchema = z.object({
	approval: z.string().regex(/^hca1\.[0-9a-f]{64}$/),
	record: z.object({ id: z.number().int().positive() }),
	token_expires_at: z.string().min(1).nullable(),
});

// Imports allow 2 MiB; leave room for the password and JSON envelope.
const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
async function readBody(request: NextRequest): Promise<unknown> {
	const reader = request.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > MAX_REQUEST_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} catch {
		return null;
	} finally {
		reader.releaseLock();
	}
}

export async function POST(request: NextRequest) {
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	function protect(response: NextResponse) {
		protectPrivateResponse(response.headers);
		response.headers.set(CORRELATION_ID_HEADER, correlationId);
		return response;
	}
	function error(status: number, message: string, reason?: string) {
		return protect(
			NextResponse.json({ message, ...(reason ? { reason } : {}) }, { status }),
		);
	}
	const originRejection = rejectCrossOriginBffMutation(request);
	if (originRejection) return protect(originRejection);
	const session = await getSessionFromRequest(request);
	if (!session) return error(401, "Sign in required.");
	const parsed = mutationSchema.safeParse(await readBody(request));
	if (!parsed.success)
		return error(400, "Invalid credential confirmation request.");
	const mutation = parsed.data;
	const operation = credentialOperation(
		mutation.method,
		mutation.path,
		mutation.body,
	);
	if (!operation)
		return error(400, "This operation does not support password confirmation.");
	const headers = new Headers({ "Content-Type": "application/json" });
	try {
		if (mutation.ifMatch) headers.set("If-Match", mutation.ifMatch);
		if (mutation.idempotencyKey)
			headers.set("Idempotency-Key", mutation.idempotencyKey);
	} catch {
		return error(400, "Invalid mutation headers.");
	}
	if (operation.kind === "import_credentials" && !mutation.idempotencyKey) {
		return error(400, "Imports require an idempotency key for safe retries.");
	}
	const expireSession = async () => {
		const response = error(401, "Your session expired. Sign in again.");
		await destroySession(session.sid);
		clearSessionCookie(response, request);
		return response;
	};
	let approvalResponse: Response;
	try {
		approvalResponse = await backendFetchRaw(
			"/api/v1/iam/credential-approvals",
			{
				method: "POST",
				token: session.token,
				correlationId,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: mutation.password, operation }),
				signal: request.signal,
			},
		);
	} catch {
		return error(
			502,
			"Could not confirm your password. The operation was not submitted.",
		);
	} finally {
		mutation.password = "";
	}
	if (approvalResponse.status === 401) {
		await approvalResponse.body?.cancel();
		const validation = await validateBackendSession({
			sid: session.sid,
			token: session.token,
			correlationId,
		});
		if (validation === "expired") return expireSession();
		if (validation === "unavailable")
			return error(502, "Could not verify your session. Try again later.");
		return error(
			403,
			"Your current password was not accepted. Try again.",
			"password_confirmation_failed",
		);
	}
	const approvalPayload: unknown = await approvalResponse
		.json()
		.catch(() => null);
	if (approvalResponse.status !== 201) {
		const response = error(
			approvalResponse.ok ? 502 : approvalResponse.status,
			getApiErrorMessage(
				approvalPayload,
				"Could not approve this credential operation.",
			),
		);
		const retryAfter = approvalResponse.headers.get("retry-after");
		if (retryAfter) response.headers.set("Retry-After", retryAfter);
		return response;
	}
	const approval = approvalSchema.safeParse(approvalPayload);
	if (!approval.success)
		return error(
			502,
			"The server returned an invalid credential approval. The operation was not submitted.",
		);
	if (operation.kind === "create_token" || operation.kind === "renew_token") {
		if (!approval.data.token_expires_at)
			return error(
				502,
				"The server did not return an approved token expiry. The operation was not submitted.",
			);
		// Do not parse this as a Date: doing so loses the server's microseconds.
		mutation.body.expires_at = approval.data.token_expires_at;
	}
	headers.set("X-Hubuum-Credential-Approval", approval.data.approval);
	try {
		const upstream = await backendFetchRaw(mutation.path, {
			method: mutation.method,
			token: session.token,
			correlationId,
			headers,
			body: JSON.stringify(mutation.body),
			signal: request.signal,
		});
		if (upstream.status === 401) {
			await upstream.body?.cancel();
			return expireSession();
		}
		// Read fully here so interrupted mutation responses receive the same recovery advice.
		const body = [204, 205, 304].includes(upstream.status)
			? null
			: await upstream.arrayBuffer();
		const response = new NextResponse(body, { status: upstream.status });
		const contentType = upstream.headers.get("content-type");
		if (body && contentType) response.headers.set("Content-Type", contentType);
		copySafeUpstreamResponseHeaders(upstream.headers, response.headers);
		return protect(response);
	} catch {
		return error(
			502,
			`The result could not be confirmed (approval #${approval.data.record.id}). Check the affected account, task, or restore status before retrying. The operation may have completed.`,
		);
	}
}
