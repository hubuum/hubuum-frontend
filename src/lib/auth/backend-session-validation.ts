import "server-only";

import type { BackendCredential } from "@/lib/backend-target";

import { backendFetchRaw } from "@/lib/api/backend";

export type BackendSessionValidation = "valid" | "expired" | "unavailable";

const pendingValidations = new Map<
	string,
	{ credentialKey: string; value: Promise<BackendSessionValidation> }
>();

async function fetchBackendSessionValidation({
	correlationId,
	token,
}: {
	correlationId?: string;
	token: BackendCredential;
}): Promise<BackendSessionValidation> {
	try {
		const response = await backendFetchRaw("/api/v1/auth/validate", {
			correlationId,
			method: "GET",
			token,
		});
		if (response.status === 200) return "valid";
		if (response.status === 401) return "expired";
		return "unavailable";
	} catch {
		return "unavailable";
	}
}

export function validateBackendSession({
	correlationId,
	sid,
	token,
}: {
	correlationId?: string;
	sid: string;
	token: BackendCredential;
}): Promise<BackendSessionValidation> {
	const pending = pendingValidations.get(sid);
	const credentialKey =
		typeof token === "string" ? token : JSON.stringify(token);
	if (pending?.credentialKey === credentialKey) {
		return pending.value;
	}

	const value = fetchBackendSessionValidation({ correlationId, token });
	pendingValidations.set(sid, { credentialKey, value });
	void value.finally(() => {
		if (pendingValidations.get(sid)?.value === value) {
			pendingValidations.delete(sid);
		}
	});
	return value;
}

export function invalidateBackendSessionValidation(sid: string): void {
	pendingValidations.delete(sid);
}
