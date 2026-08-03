export function getProxyRequestBody(
	method: string,
	body: ReadableStream<Uint8Array> | null,
): ReadableStream<Uint8Array> | undefined {
	const normalizedMethod = method.toUpperCase();
	if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
		return undefined;
	}

	return body ?? undefined;
}

export function getProxyResponseBody(
	status: number,
	body: ReadableStream<Uint8Array> | null,
): ReadableStream<Uint8Array> | null {
	if (status === 204 || status === 205 || status === 304) {
		return null;
	}

	return body;
}
