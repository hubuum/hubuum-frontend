import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { backendFetchRaw } from "@/lib/api/backend";
import {
	parseSessionResponse,
	SESSION_CLIENT_ID,
} from "@/lib/auth/session-credentials";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	authenticatedIdentityMatchesRequest,
	formatScopedIdentityName,
	LOCAL_IDENTITY_SCOPE,
	readAuthenticatedPrincipalIdentity,
	type ScopedLoginCredentials,
} from "@/lib/identity-scopes";
import { normalizeReturnPath } from "@/lib/return-path";

const optionalIdentityScopeSchema = z.preprocess(
	(value) =>
		typeof value === "string" && value.trim() ? value.trim() : undefined,
	z.string().min(1).max(160).optional(),
);

const loginSchema = z
	.object({
		identity_scope: optionalIdentityScopeSchema,
		name: z.string().min(1).optional(),
		username: z.string().min(1).optional(),
		password: z.string().min(1),
	})
	.transform((value) => ({
		identity_scope: value.identity_scope,
		name: value.name ?? value.username ?? "",
		password: value.password,
	}))
	.refine((value) => value.name.length > 0, {
		message: "name is required",
	});

const BACKEND_LOGIN_PATH = "/api/v1/auth/login";

type ParsedCredentials =
	| { credentials: ScopedLoginCredentials; fromForm: boolean }
	| { credentials: null; fromForm: boolean };

function seeOther(location: string): NextResponse {
	return new NextResponse(null, {
		status: 303,
		headers: {
			Location: location,
			"Cache-Control": "no-store",
		},
	});
}

function loginErrorLocation(code: string, returnTo: string): string {
	const searchParams = new URLSearchParams({ error: code });
	if (returnTo !== "/app") {
		searchParams.set("next", returnTo);
	}
	return `/login?${searchParams.toString()}`;
}

async function parseCredentials(
	request: NextRequest,
): Promise<ParsedCredentials> {
	const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
	const fromForm =
		contentType.includes("application/x-www-form-urlencoded") ||
		contentType.includes("multipart/form-data");

	try {
		if (contentType.includes("application/json")) {
			const body = (await request.json()) as unknown;
			return { credentials: loginSchema.parse(body), fromForm: false };
		}

		if (fromForm) {
			const formData = await request.formData();
			const body = {
				identity_scope: formData.get("identity_scope"),
				username: formData.get("username"),
				password: formData.get("password"),
			};
			return { credentials: loginSchema.parse(body), fromForm: true };
		}
	} catch {
		return { credentials: null, fromForm };
	}

	return { credentials: null, fromForm: false };
}

async function revokeIssuedToken(
	token: string,
	correlationId: string,
): Promise<void> {
	await backendFetchRaw("/api/v1/auth/logout", {
		correlationId,
		method: "POST",
		token,
	}).catch(() => undefined);
}

export async function POST(request: NextRequest) {
	const originRejection = rejectCrossOriginBffMutation(request);
	if (originRejection) return originRejection;

	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? "-";
	const returnTo = normalizeReturnPath(
		request.nextUrl.searchParams.get("next"),
	);
	console.info(
		`[hubuum-auth][cid=${correlationId}] login request received (${request.method} ${request.nextUrl.pathname})`,
	);
	const { credentials, fromForm } = await parseCredentials(request);
	console.info(
		`[hubuum-auth][cid=${correlationId}] parsed credentials fromForm=${String(fromForm)} hasCredentials=${String(Boolean(credentials))}`,
	);

	if (!credentials) {
		console.warn(
			`[hubuum-auth][cid=${correlationId}] login payload parse failed`,
		);
		if (fromForm) {
			return seeOther(loginErrorLocation("invalid_credentials", returnTo));
		}
		return NextResponse.json(
			{
				error: "BadRequest",
				message: "Invalid login payload",
			},
			{ status: 400 },
		);
	}

	const upstream = await backendFetchRaw(BACKEND_LOGIN_PATH, {
		correlationId,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ ...credentials, client_id: SESSION_CLIENT_ID }),
	});

	const payload: unknown = await upstream.json().catch(() => null);
	console.info(
		`[hubuum-auth][cid=${correlationId}] backend login status=${upstream.status}`,
	);

	if (!upstream.ok) {
		if (fromForm) {
			return seeOther(loginErrorLocation("invalid_credentials", returnTo));
		}
		return NextResponse.json(
			{
				error: "AuthenticationFailed",
				message: "Login failed",
			},
			{ status: upstream.status },
		);
	}

	const pair = parseSessionResponse(payload);
	if (!pair) {
		return NextResponse.json(
			{
				error: "AuthProtocolError",
				message: "Backend returned an invalid session",
			},
			{ status: 502 },
		);
	}

	const token = pair.access_token;
	const meResponse = await backendFetchRaw("/api/v1/iam/me", {
		correlationId,
		method: "GET",
		token,
	}).catch(() => null);
	const identity =
		meResponse?.status === 200
			? readAuthenticatedPrincipalIdentity(
					await meResponse.json().catch(() => null),
				)
			: null;
	if (
		!authenticatedIdentityMatchesRequest(identity, credentials.identity_scope)
	) {
		await revokeIssuedToken(token, correlationId);
		if (fromForm) {
			return seeOther(
				loginErrorLocation("identity_scope_unavailable", returnTo),
			);
		}
		return NextResponse.json(
			{
				error: "IdentityScopeUnavailable",
				message:
					"The requested identity scope is unavailable or unsupported by this server.",
			},
			{ status: 400 },
		);
	}
	const sessionIdentity = identity ?? {
		identityScope: credentials.identity_scope ?? LOCAL_IDENTITY_SCOPE,
		name: credentials.name,
	};
	const sessionUsername = formatScopedIdentityName(
		sessionIdentity.identityScope,
		sessionIdentity.name,
	);

	let sid: string;
	try {
		sid = await createSession(pair, sessionUsername);
	} catch {
		await revokeIssuedToken(token, correlationId);
		console.error(
			`[hubuum-auth][cid=${correlationId}] session store unavailable; verify VALKEY_URL and Valkey connectivity`,
		);
		if (fromForm) {
			return seeOther(
				loginErrorLocation("session_store_unavailable", returnTo),
			);
		}
		return NextResponse.json(
			{
				error: "SessionStoreUnavailable",
				message: "The frontend session store is unavailable.",
			},
			{ status: 503 },
		);
	}
	const response = fromForm
		? seeOther(returnTo)
		: NextResponse.json({ authenticated: true }, { status: 200 });
	response.headers.set("Cache-Control", "no-store");
	setSessionCookie(
		response,
		sid,
		Math.min(
			Date.parse(pair.refresh_expires_at),
			Date.parse(pair.absolute_expires_at),
		),
		request,
	);
	console.info(
		`[hubuum-auth][cid=${correlationId}] login succeeded and session created (fromForm=${String(fromForm)})`,
	);

	return response;
}
