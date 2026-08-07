const SAFE_INCOMING_REQUEST_HEADERS = [
	"accept",
	"content-type",
	"if-match",
	"x-hubuum-restore-capability",
] as const;

export function copySafeIncomingRequestHeaders(
	incoming: Headers,
	upstream: Headers,
): void {
	for (const header of SAFE_INCOMING_REQUEST_HEADERS) {
		const value = incoming.get(header);
		if (value !== null) {
			upstream.set(header, value);
		}
	}
}
