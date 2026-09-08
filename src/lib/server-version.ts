import "server-only";

import { backendFetchJson } from "@/lib/api/backend";

export async function fetchServerVersion(
	correlationId?: string,
): Promise<string | null> {
	try {
		// The server publishes its running version in its public OpenAPI document.
		// Do not use our bundled contract, which describes a compatibility target.
		const document = await backendFetchJson<unknown>("/api-doc/openapi.json", {
			correlationId,
			signal: AbortSignal.timeout(5000),
		});
		if (!document || typeof document !== "object" || !("info" in document)) {
			return null;
		}
		const info = document.info;
		if (!info || typeof info !== "object" || !("version" in info)) {
			return null;
		}
		return typeof info.version === "string" && info.version.trim()
			? info.version.trim()
			: null;
	} catch {
		return null;
	}
}
