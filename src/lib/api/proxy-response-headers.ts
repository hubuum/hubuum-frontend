const SAFE_UPSTREAM_RESPONSE_HEADERS = [
	"cache-control",
	"content-disposition",
	"digest",
	"x-hubuum-backup-sha256",
] as const;

export function copySafeUpstreamResponseHeaders(
	upstream: Headers,
	downstream: Headers,
): void {
	for (const header of SAFE_UPSTREAM_RESPONSE_HEADERS) {
		const value = upstream.get(header);
		if (value !== null) {
			downstream.set(header, value);
		}
	}
}
