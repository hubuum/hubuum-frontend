import "server-only";

import { NextRequest, NextResponse } from "next/server";

import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function firstHeaderValue(value: string | null): string | null {
	const first = value?.split(",", 1)[0]?.trim();
	return first || null;
}

function normalizeHttpOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		return url.origin === value ? url.origin : null;
	} catch {
		return null;
	}
}

function addOrigin(
	origins: Set<string>,
	protocol: string | null,
	host: string | null,
): void {
	if (!protocol || !host) return;
	try {
		const url = new URL(`${protocol}://${host}`);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		) {
			return;
		}
		origins.add(url.origin);
	} catch {
		// Ignore malformed host/protocol combinations.
	}
}

function allowedRequestOrigins(request: NextRequest): Set<string> {
	const origins = new Set<string>();
	const requestOrigin = normalizeHttpOrigin(request.nextUrl.origin);
	if (requestOrigin) origins.add(requestOrigin);

	const requestProtocol = request.nextUrl.protocol.replace(":", "");
	const forwardedProtocol = firstHeaderValue(
		request.headers.get("x-forwarded-proto"),
	)?.toLowerCase();
	const effectiveProtocol =
		forwardedProtocol === "http" || forwardedProtocol === "https"
			? forwardedProtocol
			: requestProtocol;
	const requestHost =
		firstHeaderValue(request.headers.get("host")) ?? request.nextUrl.host;
	const forwardedHost = firstHeaderValue(
		request.headers.get("x-forwarded-host"),
	);

	addOrigin(origins, effectiveProtocol, requestHost);
	addOrigin(origins, effectiveProtocol, forwardedHost);
	return origins;
}

function isSameOriginMutation(request: NextRequest): boolean {
	const fetchSite = request.headers
		.get("sec-fetch-site")
		?.trim()
		.toLowerCase();
	if (fetchSite && fetchSite !== "same-origin") {
		return false;
	}

	const rawOrigin = request.headers.get("origin")?.trim();
	if (rawOrigin) {
		const origin = normalizeHttpOrigin(rawOrigin);
		return origin !== null && allowedRequestOrigins(request).has(origin);
	}

	return fetchSite === "same-origin";
}

export function rejectCrossOriginBffMutation(
	request: NextRequest,
): NextResponse | null {
	const method = request.method.toUpperCase();
	if (!MUTATING_METHODS.has(method) || isSameOriginMutation(request)) {
		return null;
	}

	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	console.warn(
		`[hubuum-security][cid=${correlationId}] rejected cross-origin BFF mutation (${method})`,
	);
	return NextResponse.json(
		{
			error: "Forbidden",
			message: "Same-origin request metadata is required.",
		},
		{
			status: 403,
			headers: {
				"Cache-Control": "no-store",
				[CORRELATION_ID_HEADER]: correlationId,
			},
		},
	);
}
