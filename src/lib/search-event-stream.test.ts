import { expect, it } from "vitest";
import { readSearchEventStream } from "@/lib/search-event-stream";
function response(chunks: Uint8Array[]) {
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		{ headers: { "content-type": "text/event-stream" } },
	);
}
it("decodes fragmented UTF-8 and CRLF, ignores comments, and joins data lines", async () => {
	const bytes = new TextEncoder().encode(
		': keepalive\r\nevent: done\r\ndata: {"name":\r\ndata: "føø"}\r\n\r\n',
	);
	const events: unknown[] = [];
	await readSearchEventStream(
		response(Array.from(bytes, (byte) => new Uint8Array([byte]))),
		(event, data) => {
			events.push({ event, data });
			return event === "done";
		},
	);
	expect(events).toEqual([{ event: "done", data: { name: "føø" } }]);
});
it("rejects early EOF and invalid JSON without treating a partial page as complete", async () => {
	const encoder = new TextEncoder();
	await expect(
		readSearchEventStream(
			response([encoder.encode("event: started\ndata: {}\n\n")]),
			() => false,
		),
	).rejects.toThrow("before completion");
	await expect(
		readSearchEventStream(
			response([encoder.encode("event: done\ndata: bad\n\n")]),
			() => true,
		),
	).rejects.toThrow("invalid JSON");
});
it("cancels the reader on abort and on successful terminal completion", async () => {
	let cancelled = false;
	const controller = new AbortController();
	const pending = readSearchEventStream(
		new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				},
			}),
			{ headers: { "content-type": "text/event-stream" } },
		),
		() => false,
		controller.signal,
	);
	controller.abort();
	await expect(pending).rejects.toThrow();
	expect(cancelled).toBe(true);
	let terminalCancelled = false;
	await readSearchEventStream(
		new Response(
			new ReadableStream({
				start(stream) {
					stream.enqueue(new TextEncoder().encode("event: done\ndata: {}\n\n"));
				},
				cancel() {
					terminalCancelled = true;
				},
			}),
			{ headers: { "content-type": "text/event-stream" } },
		),
		() => true,
	);
	expect(terminalCancelled).toBe(true);
});
it("bounds an event before parsing its payload", async () => {
	const bytes = new TextEncoder().encode(
		'event: done\ndata: "' + "x".repeat(32 * 1024 * 1024) + '"\n\n',
	);
	await expect(
		readSearchEventStream(response([bytes]), () => true),
	).rejects.toThrow("32 MiB");
});
