import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hasAdminAccess } from "@/lib/auth/admin";
import { clearSessionCookie, getSessionFromRequest } from "@/lib/auth/session";
import { inspectBackend } from "@/lib/backend-discovery";
import {
	type BackendCheck,
	backendCheckSchema,
	normalizeBackendOrigin,
} from "@/lib/backend-setup";
import {
	changeBackend,
	getBackendTarget,
	sessionCredential,
} from "@/lib/backend-target";
import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { getServerEnv } from "@/lib/env";

const mutationSchema = z.object({
	action: z.enum(["check", "save"]),
	url: z.string().min(1).max(2048),
	expectedRevision: z.string().min(1),
	confirmation: backendCheckSchema.optional(),
});

async function handle(request: NextRequest) {
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	const reply = (status: number, body: object) =>
		NextResponse.json(body, {
			status,
			headers: {
				"Cache-Control": "no-store",
				[CORRELATION_ID_HEADER]: correlationId,
			},
		});
	const rejected = rejectCrossOriginBffMutation(request);
	if (rejected) return rejected;
	try {
		const session = await getSessionFromRequest(request);
		if (!session) return reply(401, { message: "Sign in required." });
		if (!(await hasAdminAccess(sessionCredential(session), correlationId)))
			return reply(403, {
				message:
					"Administrator access is required to change the console's server connection.",
			});
		const current = await getBackendTarget();
		if (!current) return reply(409, { message: "Backend setup is required." });
		const managed = Boolean(getServerEnv().BACKEND_BASE_URL);
		if (request.method === "GET") return reply(200, { ...current, managed });
		if (managed)
			return reply(409, {
				message:
					"This connection is managed by BACKEND_BASE_URL. Change the deployment configuration and restart the frontend.",
			});
		const parsed = mutationSchema.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success)
			return reply(400, { message: "Invalid connection change." });
		if (
			parsed.data.expectedRevision !== current.revision ||
			session.backendRevision !== current.revision
		)
			return reply(409, {
				message: "The connection changed. Reload before trying again.",
			});
		let check: BackendCheck;
		try {
			const origin = normalizeBackendOrigin(parsed.data.url);
			if (origin === current.origin)
				return reply(400, { message: "This is already the current server." });
			check = { ...(await inspectBackend(origin, correlationId)), origin };
		} catch (error) {
			return reply(422, {
				message:
					error instanceof Error
						? error.message
						: "The server could not be checked.",
			});
		}
		if (parsed.data.action === "check")
			return reply(200, { ...check, saved: false });
		if (JSON.stringify(parsed.data.confirmation) !== JSON.stringify(check))
			return reply(409, {
				...check,
				saved: false,
				message:
					"Review the server check and confirm switching this console for everyone. All users will need to sign in again.",
			});
		if (!(await changeBackend(current, check.origin)))
			return reply(409, {
				message: "The connection changed. Reload before trying again.",
			});
		const response = reply(200, { ...check, saved: true });
		clearSessionCookie(response, request);
		return response;
	} catch {
		return reply(503, {
			message:
				"The connection could not be updated. Check the frontend's Valkey connection and try again.",
		});
	}
}

export const GET = handle;
export const POST = handle;
