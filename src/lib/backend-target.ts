import "server-only";

import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";

function installationKey(): string {
	return `${getServerEnv().SETTINGS_PREFIX}installation:backend`;
}

export async function getBackendBaseUrl(): Promise<string | null> {
	const configured = getServerEnv().BACKEND_BASE_URL;
	if (configured) return configured;
	return getValkeyClient().get(installationKey());
}

// No expiry and no process cache: every replica sees the same one-time choice.
export async function saveInitialBackend(origin: string): Promise<boolean> {
	if (getServerEnv().BACKEND_BASE_URL) return false;
	return (
		(await getValkeyClient().set(installationKey(), origin, "NX")) === "OK"
	);
}

export async function getBackendSetupStatus(): Promise<
	"configured" | "available" | "disabled" | "unavailable"
> {
	try {
		if (await getBackendBaseUrl()) return "configured";
		return getServerEnv().SETUP_KEY ? "available" : "disabled";
	} catch {
		return "unavailable";
	}
}
