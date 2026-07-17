const PAGINATION_HEADERS = [
	"X-Next-Cursor",
	"X-Prev-Cursor",
	"X-Total-Count",
] as const;

export function copyPaginationHeaders(
	upstreamHeaders: Headers,
	responseHeaders: Headers,
): void {
	for (const headerName of PAGINATION_HEADERS) {
		const value = upstreamHeaders.get(headerName);
		if (value !== null) {
			responseHeaders.set(headerName, value);
		}
	}
}
