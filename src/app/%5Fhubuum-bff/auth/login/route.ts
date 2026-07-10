import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { backendFetchRaw } from "@/lib/api/backend";
import type {
	ApiErrorResponse,
	LoginResponse,
} from "@/lib/api/generated/models";
import { createSession, setSessionCookie } from "@/lib/auth/session";
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

const BACKEND_LOGIN_PATH = "/api/v0/auth/login";

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
	await backendFetchRaw("/api/v0/auth/logout", {
		correlationId,
		method: "POST",
		token,
	}).catch(() => undefined);
}

export async function POST(request: NextRequest) {
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ?? "-";
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
			return seeOther("/login?error=invalid_credentials");
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
		body: JSON.stringify(credentials),
	});

	const payload = (await upstream.json().catch(() => null)) as
		| LoginResponse
		| ApiErrorResponse
		| null;
	console.info(
		`[hubuum-auth][cid=${correlationId}] backend login status=${upstream.status}`,
	);

	if (!upstream.ok) {
		if (fromForm) {
			return seeOther("/login?error=invalid_credentials");
		}
		return NextResponse.json(
			payload ?? {
				error: "AuthenticationFailed",
				message: "Login failed",
			},
			{ status: upstream.status },
		);
	}

	const token = (payload as LoginResponse | null)?.token;
	if (!token) {
		return NextResponse.json(
			{
				error: "AuthProtocolError",
				message: "Backend did not return a token",
			},
			{ status: 502 },
		);
	}

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
			return seeOther("/login?error=identity_scope_unavailable");
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

	const sid = await createSession(token, sessionUsername);
	const response = fromForm
		? seeOther("/app")
		: NextResponse.json({ authenticated: true }, { status: 200 });
	setSessionCookie(response, sid, request, token, sessionUsername);
	console.info(
		`[hubuum-auth][cid=${correlationId}] login succeeded and session created (fromForm=${String(fromForm)})`,
	);

	return response;
}
