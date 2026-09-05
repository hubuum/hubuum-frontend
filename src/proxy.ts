import { NextRequest, NextResponse } from "next/server";
import { FRONTEND_API_PREFIX } from "@/lib/api/frontend";
import {
	CORRELATION_ID_COOKIE,
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { sanitizeOperationalPath } from "@/lib/operational-events";
import { REQUEST_PATH_HEADER } from "@/lib/request-context";
import {
	buildContentSecurityPolicy,
	CSP_NONCE_HEADER,
	PRIVATE_CACHE_CONTROL,
} from "@/lib/security-policy";

const LEGACY_DESIGN_COOKIE = "hubuum.design";

function stripLegacyDesignPrefix(pathname: string): string | null {
	const match = pathname.match(/^\/(?:v2|v4|v6)(?=\/|$)/);
	if (!match) return null;
	return pathname.slice(match[0].length) || "/app";
}

function requestIsHttps(request: NextRequest): boolean {
	const forwardedProto = request.headers
		.get("x-forwarded-proto")
		?.split(",")[0]
		?.trim()
		?.toLowerCase();
	const requestProto = request.nextUrl.protocol.replace(":", "").toLowerCase();
	const effectiveProto = forwardedProto || requestProto;
	return effectiveProto === "https";
}

export function proxy(request: NextRequest) {
	const path = request.nextUrl.pathname;
	const contentType = request.headers.get("content-type") ?? "-";
	const accept = request.headers.get("accept") ?? "-";
	const isApiRequest =
		path.startsWith(`${FRONTEND_API_PREFIX}/`) || path.startsWith("/api/");
	const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
	const csp = buildContentSecurityPolicy(
		nonce,
		process.env.NODE_ENV !== "production",
	);
	const headerCorrelationId = normalizeCorrelationId(
		request.headers.get(CORRELATION_ID_HEADER),
	);
	const cookieCorrelationId = normalizeCorrelationId(
		request.cookies.get(CORRELATION_ID_COOKIE)?.value,
	);
	const correlationId = isApiRequest
		? (headerCorrelationId ?? cookieCorrelationId ?? generateCorrelationId())
		: generateCorrelationId();

	console.info(
		`[hubuum-http][cid=${correlationId}] ${request.method} ${sanitizeOperationalPath(path)} ct=${contentType} accept=${accept}`,
	);

	const forwardedHeaders = new Headers(request.headers);
	forwardedHeaders.set(CSP_NONCE_HEADER, nonce);
	forwardedHeaders.set("Content-Security-Policy", csp);
	forwardedHeaders.set(CORRELATION_ID_HEADER, correlationId);
	forwardedHeaders.set(
		REQUEST_PATH_HEADER,
		`${request.nextUrl.pathname}${request.nextUrl.search}`,
	);
	const canonicalDesignPath = stripLegacyDesignPrefix(path);
	const requestMethodCanRedirect =
		request.method === "GET" || request.method === "HEAD";

	let response: NextResponse;
	if (canonicalDesignPath && requestMethodCanRedirect) {
		const redirectUrl = request.nextUrl.clone();
		redirectUrl.pathname = canonicalDesignPath;
		response = NextResponse.redirect(redirectUrl);
	} else if (canonicalDesignPath) {
		const rewriteUrl = request.nextUrl.clone();
		rewriteUrl.pathname = canonicalDesignPath;
		response = NextResponse.rewrite(rewriteUrl, {
			request: {
				headers: forwardedHeaders,
			},
		});
	} else {
		response = NextResponse.next({
			request: {
				headers: forwardedHeaders,
			},
		});
	}

	response.headers.set(CORRELATION_ID_HEADER, correlationId);
	response.headers.set("Content-Security-Policy", csp);
	if (isApiRequest || request.headers.get("accept")?.includes("text/html")) {
		response.headers.set("Cache-Control", PRIVATE_CACHE_CONTROL);
	}
	if (request.cookies.has(LEGACY_DESIGN_COOKIE)) {
		response.cookies.set(LEGACY_DESIGN_COOKIE, "", {
			httpOnly: true,
			maxAge: 0,
			path: "/",
			sameSite: "lax",
			secure: requestIsHttps(request),
		});
	}

	const shouldUpdateCookie = isApiRequest
		? !headerCorrelationId && cookieCorrelationId !== correlationId
		: true;
	if (shouldUpdateCookie) {
		response.cookies.set(CORRELATION_ID_COOKIE, correlationId, {
			httpOnly: true,
			secure: requestIsHttps(request),
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 30,
		});
	}

	return response;
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon.png|apple-touch-icon-precomposed.png|theme-init.js).*)",
	],
};
