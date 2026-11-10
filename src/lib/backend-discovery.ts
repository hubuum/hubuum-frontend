import "server-only";

import { verifyBackendInstallation } from "@/lib/backend-setup";
import { CORRELATION_ID_HEADER } from "@/lib/correlation";

async function readJson(
	response: Response,
	maxBytes: number,
): Promise<unknown> {
	const reader = response.body?.getReader();
	if (
		!response.ok ||
		!response.headers.get("content-type")?.includes("application/json") ||
		!reader
	) {
		await reader?.cancel();
		throw new Error(
			"The server did not return the expected Hubuum API response. Check the address and proxy routing.",
		);
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > maxBytes) {
				await reader.cancel();
				throw new Error("The server's discovery response is too large.");
			}
			chunks.push(value);
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
		} catch {
			throw new Error("The server returned invalid discovery JSON.");
		}
	} finally {
		reader.releaseLock();
	}
}

// Only called after the deployment's setup key has been verified. Internal
// HTTP origins are intentional: the frontend commonly shares a private network
// with Hubuum. No browser credentials or setup key go to the candidate server.
export async function inspectBackend(
	origin: string,
	correlationId: string,
): Promise<string> {
	const init: RequestInit = {
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(8_000),
		headers: {
			Accept: "application/json",
			[CORRELATION_ID_HEADER]: correlationId,
		},
	};
	const get = async (path: string) => {
		try {
			return await fetch(new URL(path, origin), init);
		} catch {
			throw new Error(
				"Could not reach the server. Check the URL, TLS certificate, and connectivity from the frontend. Redirects are not followed; use the final server URL.",
			);
		}
	};
	const ready = await get("/readyz");
	await ready.body?.cancel();
	if (!ready.ok)
		throw new Error(
			"The server is reachable but is not ready. Resolve its dependency errors and try again.",
		);
	const document = await readJson(
		await get("/api-doc/openapi.json"),
		8 * 1024 * 1024,
	);
	const config = await readJson(await get("/api/v1/config"), 64 * 1024);
	return verifyBackendInstallation(document, config);
}
