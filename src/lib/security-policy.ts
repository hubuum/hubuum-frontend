export const CSP_NONCE_HEADER = "x-hubuum-nonce";
export const PRIVATE_CACHE_CONTROL = "private, no-store";
export const REPORT_SANDBOX_POLICY =
	"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function buildContentSecurityPolicy(
	nonce: string,
	development: boolean,
): string {
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
		// CodeMirror and resizable controls generate styles at runtime.
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"connect-src 'self'",
		"font-src 'self' data:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
}

export function protectPrivateResponse(headers: Headers): void {
	headers.set("Cache-Control", PRIVATE_CACHE_CONTROL);
	headers.set("X-Content-Type-Options", "nosniff");
	const contentType = headers
		.get("content-type")
		?.split(";")[0]
		?.trim()
		.toLowerCase();
	if (
		contentType &&
		["text/html", "application/xhtml+xml", "image/svg+xml"].includes(
			contentType,
		)
	) {
		headers.set("Content-Security-Policy", REPORT_SANDBOX_POLICY);
		headers.set("Referrer-Policy", "no-referrer");
	}
}
