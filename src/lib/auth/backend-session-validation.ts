import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";

export type BackendSessionValidation =
	| "valid"
	| "expired"
	| "unavailable";

const pendingValidations = new Map<
	string,
	Promise<BackendSessionValidation>
>();

async function fetchBackendSessionValidation({
	correlationId,
	token,
}: {
	correlationId?: string;
	token: string;
}): Promise<BackendSessionValidation> {
	try {
		const response = await backendFetchRaw("/api/v0/auth/validate", {
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
	token: string;
}): Promise<BackendSessionValidation> {
	const pending = pendingValidations.get(sid);
	if (pending) {
		return pending;
	}

	const value = fetchBackendSessionValidation({ correlationId, token });
	pendingValidations.set(sid, value);
	void value.finally(() => {
		if (pendingValidations.get(sid) === value) {
			pendingValidations.delete(sid);
		}
	});
	return value;
}

export function invalidateBackendSessionValidation(sid: string): void {
	pendingValidations.delete(sid);
}
