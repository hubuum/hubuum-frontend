import { getApiErrorMessage } from "@/lib/api/errors";
/** Reads one finite SSE response. No reconnection or implicit retry is performed. */
export async function readSearchEventStream(
	response: Response,
	onEvent: (event: string, data: unknown) => boolean,
	signal?: AbortSignal,
): Promise<void> {
	if (!response.ok)
		throw new Error(
			getApiErrorMessage(
				await response.json().catch(() => null),
				"Search streaming is unavailable or the request failed.",
			),
		);
	if (
		!response.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("text/event-stream") ||
		!response.body
	)
		throw new Error("The server did not return a search event stream.");
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let buffer = "",
		event = "message",
		data: string[] = [],
		eventSize = 0,
		bytes = 0,
		count = 0;
	const abort = () => {
		void reader.cancel().catch(() => undefined);
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			signal?.throwIfAborted();
			const chunk = await reader.read();
			signal?.throwIfAborted();
			if (chunk.done)
				throw new Error(
					"Search stream ended before completion. Results are incomplete; retry explicitly.",
				);
			bytes += chunk.value.byteLength;
			if (bytes > 64 * 1024 * 1024)
				throw new Error(
					"Search stream exceeds the 64 MiB browser limit. Narrow the query or reduce the page size.",
				);
			buffer += decoder.decode(chunk.value, { stream: true });
			while (true) {
				const end = buffer.search(/[\r\n]/);
				if (end < 0 || (buffer[end] === "\r" && end === buffer.length - 1))
					break;
				const line = buffer.slice(0, end);
				buffer = buffer.slice(
					end + (buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1),
				);
				if (line === "") {
					if (data.length) {
						if (++count > 2000)
							throw new Error("Search stream contains too many events.");
						let payload: unknown;
						try {
							payload = JSON.parse(data.join("\n"));
						} catch {
							throw new Error("Search stream contains invalid JSON.");
						}
						if (onEvent(event, payload)) return;
					}
					event = "message";
					data = [];
					eventSize = 0;
					continue;
				}
				if (line.startsWith(":")) continue;
				const colon = line.indexOf(":");
				const field = colon < 0 ? line : line.slice(0, colon);
				const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
				if (field === "event") event = value;
				if (field === "data") {
					data.push(value);
					eventSize += value.length;
					if (eventSize > 32 * 1024 * 1024)
						throw new Error(
							"Search event exceeds the 32 MiB browser limit. Reduce the page size.",
						);
				}
			}
			if (buffer.length + eventSize > 32 * 1024 * 1024)
				throw new Error(
					"Search event exceeds the 32 MiB browser limit. Reduce the page size.",
				);
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
