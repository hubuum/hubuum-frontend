import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";

export async function getCurrentPrincipalId(
	token: string,
	correlationId?: string,
): Promise<number | null> {
	const response = await backendFetchRaw("/api/v1/iam/me", {
		correlationId,
		method: "GET",
		token,
	});
	if (response.status !== 200) return null;

	const payload = (await response.json().catch(() => null)) as {
		principal?: { principal_id?: unknown };
	} | null;
	const principalId = payload?.principal?.principal_id;
	return Number.isInteger(principalId) && Number(principalId) > 0
		? Number(principalId)
		: null;
}
